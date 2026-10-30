package webui

import (
	"sync"
	"time"
)

const (
	loginMaxFailures    = 5
	loginBanDuration    = 15 * time.Minute
	attemptMaxIdleTime  = 30 * time.Minute
	attemptCleanupEvery = 10 * time.Minute
)

type loginAttempt struct {
	count        int
	lastActivity time.Time
	blockedUntil time.Time
}

// loginLimiter throttles password guessing on the panel login/setup endpoints.
// It mirrors the upstream management API pattern: after loginMaxFailures
// consecutive failures the client IP is blocked for loginBanDuration.
type loginLimiter struct {
	mu       sync.Mutex
	attempts map[string]*loginAttempt
	stop     chan struct{}
	once     sync.Once
}

func newLoginLimiter() *loginLimiter {
	l := &loginLimiter{
		attempts: make(map[string]*loginAttempt),
		stop:     make(chan struct{}),
	}
	go l.cleanupLoop()
	return l
}

func (l *loginLimiter) cleanupLoop() {
	ticker := time.NewTicker(attemptCleanupEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			l.purge(time.Now())
		case <-l.stop:
			return
		}
	}
}

func (l *loginLimiter) purge(now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for ip, attempt := range l.attempts {
		if !attempt.blockedUntil.IsZero() && now.Before(attempt.blockedUntil) {
			continue
		}
		if now.Sub(attempt.lastActivity) > attemptMaxIdleTime {
			delete(l.attempts, ip)
		}
	}
}

// Blocked reports the remaining ban duration for the IP, if any.
func (l *loginLimiter) Blocked(ip string) (time.Duration, bool) {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	attempt, ok := l.attempts[ip]
	if !ok || attempt.blockedUntil.IsZero() {
		return 0, false
	}
	if now.Before(attempt.blockedUntil) {
		return attempt.blockedUntil.Sub(now).Round(time.Second), true
	}
	attempt.blockedUntil = time.Time{}
	attempt.count = 0
	return 0, false
}

// Fail records a failed attempt and blocks the IP once the threshold is hit.
func (l *loginLimiter) Fail(ip string) {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	attempt, ok := l.attempts[ip]
	if !ok {
		attempt = &loginAttempt{}
		l.attempts[ip] = attempt
	}
	attempt.count++
	attempt.lastActivity = now
	if attempt.count >= loginMaxFailures {
		attempt.blockedUntil = now.Add(loginBanDuration)
		attempt.count = 0
	}
}

// Reset clears the failure counter after a successful login.
func (l *loginLimiter) Reset(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, ip)
}

func (l *loginLimiter) Close() {
	l.once.Do(func() { close(l.stop) })
}
