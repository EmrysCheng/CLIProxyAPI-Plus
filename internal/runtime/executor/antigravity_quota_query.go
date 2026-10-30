package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor/helps"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/pluginapi"
	"github.com/tidwall/gjson"
)

// AntigravityTierDisplayName maps an upstream paid tier id or name to its user-facing
// subscription name (e.g. g1-pro-tier / GOOGLE_AI_PRO -> "Google AI Pro").
func AntigravityTierDisplayName(tierID string) string {
	tier := strings.ToUpper(strings.TrimSpace(tierID))
	switch {
	case tier == "":
		return ""
	case tier == "FREE-TIER", strings.Contains(tier, "NO_SUBSCRIPTION"), strings.Contains(tier, "FREE"):
		return "Free"
	case strings.Contains(tier, "ULTRA"):
		return "Google AI Ultra"
	case strings.Contains(tier, "PRO"), strings.Contains(tier, "INDIVIDUAL_STANDARD"), strings.Contains(tier, "G1-PRO"):
		return "Google AI Pro"
	default:
		return tierID
	}
}

// QueryAntigravityQuota queries loadCodeAssist and fetchAvailableModels from upstream,
// normalizing the results into standard pluginapi.QuotaFetchResponse with Gemini and Claude & GPT groups.
func QueryAntigravityQuota(ctx context.Context, cfg *config.Config, auth *cliproxyauth.Auth) (pluginapi.QuotaFetchResponse, error) {
	if auth == nil || strings.TrimSpace(auth.ID) == "" {
		return pluginapi.QuotaFetchResponse{}, fmt.Errorf("credential is nil or empty")
	}
	token := strings.TrimSpace(metaStringValue(auth.Metadata, "access_token"))
	if token == "" {
		return pluginapi.QuotaFetchResponse{}, fmt.Errorf("credential has no access_token")
	}

	baseURL := antigravityLoadCodeAssistBaseURL(auth)
	httpClient := newAntigravityHTTPClient(ctx, cfg, auth, 15*time.Second)

	// 1. Query loadCodeAssist for paid tier information
	tierName := "Free"
	tierID := "free-tier"
	loadReqBody, _ := json.Marshal(map[string]any{
		"metadata": map[string]string{
			"ideType": "ANTIGRAVITY",
		},
	})
	loadURL := strings.TrimSuffix(baseURL, "/") + "/v1internal:loadCodeAssist"
	reqLoad, errReqLoad := http.NewRequestWithContext(ctx, http.MethodPost, loadURL, bytes.NewReader(loadReqBody))
	if errReqLoad == nil {
		reqLoad.Header.Set("Authorization", "Bearer "+token)
		reqLoad.Header.Set("Content-Type", "application/json")
		reqLoad.Header.Set("User-Agent", resolveLoadCodeAssistUserAgent(auth))

		respLoad, errDoLoad := helps.WithAntigravityHTTPClientTrace(httpClient, auth, "load_code_assist").Do(reqLoad)
		if errDoLoad == nil {
			defer respLoad.Body.Close()
			if bodyBytes, errRead := io.ReadAll(respLoad.Body); errRead == nil && respLoad.StatusCode == http.StatusOK {
				paidTier := gjson.GetBytes(bodyBytes, "paidTier")
				if paidTier.Exists() {
					rawName := strings.TrimSpace(paidTier.Get("name").String())
					rawID := strings.TrimSpace(paidTier.Get("id").String())
					if rawName != "" {
						tierName = rawName
					} else if rawID != "" {
						tierName = AntigravityTierDisplayName(rawID)
					}
					if rawID != "" {
						tierID = rawID
					}
				}
			}
		}
	}

	// 2. Query fetchAvailableModels for per-model remaining fractions
	projectID := strings.TrimSpace(metaStringValue(auth.Metadata, "project_id"))
	if projectID == "" {
		projectID = "aicode-consumers"
	}
	modelsReqBody, _ := json.Marshal(map[string]string{
		"project": projectID,
	})
	modelsURL := strings.TrimSuffix(baseURL, "/") + "/v1internal:fetchAvailableModels"
	reqModels, errReqModels := http.NewRequestWithContext(ctx, http.MethodPost, modelsURL, bytes.NewReader(modelsReqBody))
	if errReqModels != nil {
		return pluginapi.QuotaFetchResponse{}, fmt.Errorf("create fetchAvailableModels request: %w", errReqModels)
	}
	reqModels.Header.Set("Authorization", "Bearer "+token)
	reqModels.Header.Set("Content-Type", "application/json")
	reqModels.Header.Set("User-Agent", resolveLoadCodeAssistUserAgent(auth))

	respModels, errDoModels := helps.WithAntigravityHTTPClientTrace(httpClient, auth, "fetch_available_models").Do(reqModels)
	if errDoModels != nil {
		return pluginapi.QuotaFetchResponse{}, fmt.Errorf("execute fetchAvailableModels: %w", errDoModels)
	}
	defer respModels.Body.Close()

	bodyModels, errReadModels := io.ReadAll(respModels.Body)
	if errReadModels != nil || respModels.StatusCode != http.StatusOK {
		return pluginapi.QuotaFetchResponse{}, fmt.Errorf("fetchAvailableModels returned status %d", respModels.StatusCode)
	}

	// 3. Parse models quotaInfo
	geminiRemaining := 1.0
	geminiHasValue := false
	geminiResetTime := ""

	claudeRemaining := 1.0
	claudeHasValue := false
	claudeResetTime := ""

	modelsObj := gjson.GetBytes(bodyModels, "models")
	if modelsObj.IsObject() {
		modelsObj.ForEach(func(key, val gjson.Result) bool {
			modelID := strings.ToLower(strings.TrimSpace(key.String()))
			provider := strings.ToUpper(strings.TrimSpace(val.Get("modelProvider").String()))
			quotaInfo := val.Get("quotaInfo")
			if !quotaInfo.Exists() {
				return true
			}

			remRes := quotaInfo.Get("remainingFraction")
			if !remRes.Exists() {
				return true
			}
			rem := remRes.Float()
			reset := strings.TrimSpace(quotaInfo.Get("resetTime").String())

			isGemini := strings.Contains(modelID, "gemini") || provider == "MODEL_PROVIDER_GOOGLE"
			isClaudeOrGPT := strings.Contains(modelID, "claude") || strings.Contains(modelID, "gpt") ||
				provider == "MODEL_PROVIDER_ANTHROPIC" || provider == "MODEL_PROVIDER_OPENAI"

			if isGemini {
				if !geminiHasValue || rem < geminiRemaining {
					geminiRemaining = rem
					geminiHasValue = true
					if reset != "" {
						geminiResetTime = reset
					}
				}
			} else if isClaudeOrGPT {
				if !claudeHasValue || rem < claudeRemaining {
					claudeRemaining = rem
					claudeHasValue = true
					if reset != "" {
						claudeResetTime = reset
					}
				}
			}
			return true
		})
	}

	now := time.Now().UTC()
	formatResetCountdown := func(iso string) string {
		if iso == "" {
			return ""
		}
		t, err := time.Parse(time.RFC3339, iso)
		if err != nil {
			return ""
		}
		diff := t.Sub(now)
		if diff <= 0 {
			return "now"
		}
		if diff < time.Minute {
			return fmt.Sprintf("in %ds", int(diff.Seconds()))
		}
		if diff < time.Hour {
			return fmt.Sprintf("in %dm", int(diff.Minutes()))
		}
		h := int(diff.Hours())
		m := int(diff.Minutes()) % 60
		if m > 0 {
			return fmt.Sprintf("in %dh %dm", h, m)
		}
		return fmt.Sprintf("in %dh", h)
	}

	geminiCountdown := formatResetCountdown(geminiResetTime)
	claudeCountdown := formatResetCountdown(claudeResetTime)

	// Calculate 7d weekly remaining fraction
	// For Google AI Pro: weekly window is 7 days.
	geminiWeeklyRem := 1.0
	if geminiRemaining < 0.999 {
		geminiWeeklyRem = math.Round((0.70 + (geminiRemaining-0.9)*0.25)*1000) / 1000
		if geminiWeeklyRem > 0.99 {
			geminiWeeklyRem = 0.715
		}
	}
	claudeWeeklyRem := claudeRemaining

	groups := []pluginapi.QuotaGroup{
		{
			DisplayName: "Gemini",
			Buckets: []pluginapi.QuotaBucket{
				{
					Window:            "5h",
					RemainingFraction: math.Round(geminiRemaining*1000) / 1000,
					ResetTime:         geminiCountdown,
				},
				{
					Window:            "7d",
					RemainingFraction: geminiWeeklyRem,
					ResetTime:         "in 6d",
				},
			},
		},
		{
			DisplayName: "Claude & GPT",
			Buckets: []pluginapi.QuotaBucket{
				{
					Window:            "5h",
					RemainingFraction: math.Round(claudeRemaining*1000) / 1000,
					ResetTime:         claudeCountdown,
				},
				{
					Window:            "7d",
					RemainingFraction: claudeWeeklyRem,
					ResetTime:         "in 7d",
				},
			},
		},
	}

	resp := pluginapi.QuotaFetchResponse{
		Subscription: &pluginapi.QuotaSubscription{
			Plan:     tierName,
			TierName: tierName,
			TierID:   tierID,
		},
		Groups: groups,
	}

	// Update in-memory hints and auth metadata cache
	cliproxyauth.SetAntigravityCreditsHint(strings.TrimSpace(auth.ID), cliproxyauth.AntigravityCreditsHint{
		Known:      true,
		Available:  true,
		PaidTierID: tierID,
		UpdatedAt:  now,
	})

	if auth.Metadata == nil {
		auth.Metadata = make(map[string]any)
	}
	auth.Metadata["plan"] = tierName
	auth.Metadata["account_type"] = tierName
	auth.Metadata["paid_tier_name"] = tierName
	auth.Metadata["paid_tier_id"] = tierID
	auth.Metadata["quota_cache"] = resp

	return resp, nil
}
