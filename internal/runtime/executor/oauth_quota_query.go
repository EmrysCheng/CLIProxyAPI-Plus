package executor

import (
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/auth/devin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor/helps"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/pluginapi"
	"github.com/tidwall/gjson"
)

func formatRelativeDuration(d time.Duration) string {
	if d <= 0 {
		return "now"
	}
	if d < time.Minute {
		return fmt.Sprintf("in %ds", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("in %dm", int(d.Minutes()))
	}
	if d < 24*time.Hour {
		h := int(d.Hours())
		m := int(d.Minutes()) % 60
		if m > 0 {
			return fmt.Sprintf("in %dh %dm", h, m)
		}
		return fmt.Sprintf("in %dh", h)
	}
	days := int(d.Hours() / 24)
	return fmt.Sprintf("in %dd", days)
}

// QueryCodexQuota queries ChatGPT / Codex usage endpoint (wham/usage) for 5h and weekly rate limits.
func QueryCodexQuota(ctx context.Context, cfg *config.Config, auth *cliproxyauth.Auth) (pluginapi.QuotaFetchResponse, error) {
	if auth == nil || strings.TrimSpace(auth.ID) == "" {
		return pluginapi.QuotaFetchResponse{}, fmt.Errorf("credential is nil or empty")
	}
	token := strings.TrimSpace(metaStringValue(auth.Metadata, "access_token"))
	if token == "" {
		return pluginapi.QuotaFetchResponse{}, fmt.Errorf("credential has no access_token")
	}

	httpClient := helps.NewProxyAwareHTTPClient(ctx, cfg, auth, 15*time.Second)
	reqURL := "https://chatgpt.com/backend-api/wham/usage"
	req, errReq := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if errReq != nil {
		return pluginapi.QuotaFetchResponse{}, fmt.Errorf("create codex usage request: %w", errReq)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "application/json")
	if accountID := strings.TrimSpace(metaStringValue(auth.Metadata, "account_id")); accountID != "" {
		req.Header.Set("ChatGPT-Account-Id", accountID)
	}

	resp, errDo := httpClient.Do(req)
	if errDo != nil {
		return pluginapi.QuotaFetchResponse{}, fmt.Errorf("execute codex usage query: %w", errDo)
	}
	defer resp.Body.Close()

	bodyBytes, errRead := io.ReadAll(resp.Body)
	if errRead != nil || resp.StatusCode != http.StatusOK {
		return pluginapi.QuotaFetchResponse{}, fmt.Errorf("codex usage query returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	// Parse with helps.ParseCodexQuotaEventHeaders
	headers := helps.ParseCodexQuotaEventHeaders(bodyBytes)
	if headers != nil {
		auth.Quota.ObserveResponseHeadersForProvider("codex", headers, time.Now())
	}

	planType := strings.TrimSpace(gjson.GetBytes(bodyBytes, "plan_type").String())
	if planType == "" && headers != nil {
		planType = strings.TrimSpace(headers.Get("X-Codex-Plan-Type"))
	}
	planDisplay := "ChatGPT Free"
	switch strings.ToLower(planType) {
	case "plus":
		planDisplay = "ChatGPT Plus"
	case "team":
		planDisplay = "ChatGPT Team"
	case "pro":
		planDisplay = "ChatGPT Pro"
	case "enterprise":
		planDisplay = "ChatGPT Enterprise"
	}

	var buckets []pluginapi.QuotaBucket
	primaryUsed := gjson.GetBytes(bodyBytes, "rate_limits.primary.used_percent")
	primaryReset := gjson.GetBytes(bodyBytes, "rate_limits.primary.reset_after_seconds")
	if primaryUsed.Exists() {
		remFraction := math.Max(0, math.Min(1.0, 1.0-(primaryUsed.Float()/100.0)))
		resetStr := ""
		if primaryReset.Exists() && primaryReset.Int() > 0 {
			resetStr = formatRelativeDuration(time.Duration(primaryReset.Int()) * time.Second)
		}
		buckets = append(buckets, pluginapi.QuotaBucket{
			Window:            "5h",
			RemainingFraction: math.Round(remFraction*1000) / 1000,
			ResetTime:         resetStr,
		})
	}

	secondaryUsed := gjson.GetBytes(bodyBytes, "rate_limits.secondary.used_percent")
	secondaryReset := gjson.GetBytes(bodyBytes, "rate_limits.secondary.reset_after_seconds")
	if secondaryUsed.Exists() {
		remFraction := math.Max(0, math.Min(1.0, 1.0-(secondaryUsed.Float()/100.0)))
		resetStr := ""
		if secondaryReset.Exists() && secondaryReset.Int() > 0 {
			resetStr = formatRelativeDuration(time.Duration(secondaryReset.Int()) * time.Second)
		}
		buckets = append(buckets, pluginapi.QuotaBucket{
			Window:            "7d",
			RemainingFraction: math.Round(remFraction*1000) / 1000,
			ResetTime:         resetStr,
		})
	}

	if len(buckets) == 0 {
		buckets = append(buckets,
			pluginapi.QuotaBucket{Window: "5h", RemainingFraction: 1.0},
			pluginapi.QuotaBucket{Window: "7d", RemainingFraction: 1.0},
		)
	}

	result := pluginapi.QuotaFetchResponse{
		Subscription: &pluginapi.QuotaSubscription{
			Plan:     planDisplay,
			TierName: planDisplay,
		},
		Groups: []pluginapi.QuotaGroup{
			{
				DisplayName: "OpenAI Codex",
				Buckets:     buckets,
			},
		},
	}

	if auth.Metadata == nil {
		auth.Metadata = make(map[string]any)
	}
	auth.Metadata["plan"] = planDisplay
	auth.Metadata["account_type"] = planDisplay
	auth.Metadata["quota_cache"] = result

	return result, nil
}

// QueryDevinQuota queries Cognition Devin GetUserStatus Connect-RPC endpoint.
func QueryDevinQuota(ctx context.Context, cfg *config.Config, auth *cliproxyauth.Auth) (pluginapi.QuotaFetchResponse, error) {
	if auth == nil || strings.TrimSpace(auth.ID) == "" {
		return pluginapi.QuotaFetchResponse{}, fmt.Errorf("credential is nil or empty")
	}
	token := strings.TrimSpace(metaStringValue(auth.Metadata, "access_token"))
	if token == "" {
		return pluginapi.QuotaFetchResponse{}, fmt.Errorf("credential has no access_token")
	}

	httpClient := helps.NewProxyAwareHTTPClient(ctx, cfg, auth, 15*time.Second)
	devinSvc := devin.NewDevinAuthService(httpClient)
	status, errStatus := devinSvc.FetchUserStatus(ctx, token, "")
	if errStatus != nil {
		return pluginapi.QuotaFetchResponse{}, fmt.Errorf("fetch devin user status: %w", errStatus)
	}

	planName := "Devin"
	if status.Plan != "" {
		planName = "Devin " + strings.Title(strings.ToLower(status.Plan))
	}

	now := time.Now().UTC()
	dailyResetStr := ""
	if !status.DailyQuotaResetAt.IsZero() && status.DailyQuotaResetAt.After(now) {
		dailyResetStr = formatRelativeDuration(status.DailyQuotaResetAt.Sub(now))
	}
	weeklyResetStr := ""
	if !status.WeeklyQuotaResetAt.IsZero() && status.WeeklyQuotaResetAt.After(now) {
		weeklyResetStr = formatRelativeDuration(status.WeeklyQuotaResetAt.Sub(now))
	}

	dailyFraction := math.Max(0, math.Min(1.0, float64(status.DailyQuotaRemainingPercent)/100.0))
	weeklyFraction := math.Max(0, math.Min(1.0, float64(status.WeeklyQuotaRemainingPercent)/100.0))

	result := pluginapi.QuotaFetchResponse{
		Subscription: &pluginapi.QuotaSubscription{
			Plan:     planName,
			TierName: planName,
		},
		Groups: []pluginapi.QuotaGroup{
			{
				DisplayName: "Devin Quota",
				Buckets: []pluginapi.QuotaBucket{
					{
						Window:            "Daily",
						RemainingFraction: math.Round(dailyFraction*1000) / 1000,
						ResetTime:         dailyResetStr,
					},
					{
						Window:            "Weekly",
						RemainingFraction: math.Round(weeklyFraction*1000) / 1000,
						ResetTime:         weeklyResetStr,
					},
				},
			},
		},
	}

	if auth.Metadata == nil {
		auth.Metadata = make(map[string]any)
	}
	auth.Metadata["plan"] = planName
	auth.Metadata["account_type"] = planName
	if status.OrgName != "" {
		auth.Metadata["org_name"] = status.OrgName
	}
	auth.Metadata["quota_cache"] = result

	return result, nil
}

// QueryGenericOAuthQuota synthesizes normalized quota response for Claude, Kimi, xAI, Meta, and Gemini.
func QueryGenericOAuthQuota(auth *cliproxyauth.Auth) pluginapi.QuotaFetchResponse {
	provider := strings.ToLower(strings.TrimSpace(auth.Provider))
	planName := "Free"
	groupName := strings.Title(provider)
	var buckets []pluginapi.QuotaBucket

	switch provider {
	case "claude":
		planName = "Claude Pro"
		groupName = "Anthropic Claude"
		if org, ok := auth.Metadata["organization_name"].(string); ok && org != "" {
			planName = org
		}
		if metaPlan, ok := auth.Metadata["plan"].(string); ok && metaPlan != "" {
			planName = metaPlan
		}
		buckets = []pluginapi.QuotaBucket{
			{Window: "5h", RemainingFraction: 1.0},
			{Window: "7d", RemainingFraction: 1.0},
		}

	case "kimi", "kimi-ai":
		planName = "Kimi Code"
		groupName = "Moonshot Kimi"
		if provider == "kimi-ai" {
			planName = "Kimi AI"
		}
		buckets = []pluginapi.QuotaBucket{
			{Window: "5h", RemainingFraction: 1.0},
			{Window: "Monthly", RemainingFraction: 1.0},
		}

	case "xai":
		planName = "SuperGrok"
		groupName = "xAI Grok"
		if metaPlan, ok := auth.Metadata["plan"].(string); ok && metaPlan != "" {
			planName = metaPlan
		}
		buckets = []pluginapi.QuotaBucket{
			{Window: "5h", RemainingFraction: 1.0},
			{Window: "Monthly", RemainingFraction: 1.0},
		}

	case "meta":
		planName = "Muse Code Full"
		groupName = "Meta Muse"
		buckets = []pluginapi.QuotaBucket{
			{Window: "5h", RemainingFraction: 1.0},
			{Window: "7d", RemainingFraction: 1.0},
		}

	case "gemini":
		planName = "Google AI Studio"
		groupName = "Google Gemini"
		buckets = []pluginapi.QuotaBucket{
			{Window: "Daily", RemainingFraction: 1.0},
			{Window: "Monthly", RemainingFraction: 1.0},
		}

	default:
		planName = "Standard"
		buckets = []pluginapi.QuotaBucket{
			{Window: "Monthly", RemainingFraction: 1.0},
		}
	}

	result := pluginapi.QuotaFetchResponse{
		Subscription: &pluginapi.QuotaSubscription{
			Plan:     planName,
			TierName: planName,
		},
		Groups: []pluginapi.QuotaGroup{
			{
				DisplayName: groupName,
				Buckets:     buckets,
			},
		},
	}

	if auth.Metadata == nil {
		auth.Metadata = make(map[string]any)
	}
	auth.Metadata["plan"] = planName
	auth.Metadata["account_type"] = planName
	auth.Metadata["quota_cache"] = result

	return result
}
