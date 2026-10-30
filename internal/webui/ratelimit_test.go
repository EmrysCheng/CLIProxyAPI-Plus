package webui

import (
	"testing"
	"time"
)

func TestLoginLimiterBlocksAfterThreshold(t *testing.T) {
	l := newLoginLimiter()
	defer l.Close()

	const ip = "10.0.0.1"
	for i := 0; i < loginMaxFailures-1; i++ {
		l.Fail(ip)
		if _, blocked := l.Blocked(ip); blocked {
			t.Fatalf("blocked early at failure %d", i+1)
		}
	}
	l.Fail(ip)
	if _, blocked := l.Blocked(ip); !blocked {
		t.Fatal("IP not blocked after threshold")
	}
	// A different IP is unaffected.
	if _, blocked := l.Blocked("10.0.0.2"); blocked {
		t.Fatal("unrelated IP blocked")
	}
}

func TestLoginLimiterReset(t *testing.T) {
	l := newLoginLimiter()
	defer l.Close()
	const ip = "10.1.1.1"
	for i := 0; i < loginMaxFailures-1; i++ {
		l.Fail(ip)
	}
	l.Reset(ip)
	for i := 0; i < loginMaxFailures-1; i++ {
		l.Fail(ip)
		if _, blocked := l.Blocked(ip); blocked {
			t.Fatal("blocked before threshold after reset")
		}
	}
}

func TestLoginLimiterPurge(t *testing.T) {
	l := newLoginLimiter()
	defer l.Close()
	const ip = "10.2.2.2"
	l.Fail(ip)
	// Force the entry stale, then purge.
	l.mu.Lock()
	l.attempts[ip].lastActivity = time.Now().Add(-attemptMaxIdleTime - time.Minute)
	l.mu.Unlock()
	l.purge(time.Now())
	l.mu.Lock()
	_, exists := l.attempts[ip]
	l.mu.Unlock()
	if exists {
		t.Fatal("stale attempt not purged")
	}
	if remaining, blocked := l.Blocked(ip); blocked || remaining != 0 {
		t.Fatal("purged IP reported blocked")
	}
}
