const callTracker = {
  calls: new Map(),
  stats: {
    totalInitiated: 0,
    currentActive: 0,
    peakConcurrent: 0,
    completed: 0,
    failed: 0,
    rateLimited: 0,
    errors: {},
  },

  addCall(uuid, details) {
    this.calls.set(uuid, {
      ...details,
      startTime: Date.now(),
      status: "initiated",
    });
    this.stats.totalInitiated++;
    this.stats.currentActive++;
    if (this.stats.currentActive > this.stats.peakConcurrent) {
      this.stats.peakConcurrent = this.stats.currentActive;
    }
  },

  updateCall(uuid, updates) {
    const call = this.calls.get(uuid);
    if (call) {
      Object.assign(call, updates);
    }
  },

  completeCall(uuid, status = "completed") {
    const call = this.calls.get(uuid);
    if (call && call.status !== "completed" && call.status !== "failed") {
      call.status = status;
      call.endTime = Date.now();
      call.duration = call.endTime - call.startTime;
      
      this.stats.currentActive = Math.max(0, this.stats.currentActive - 1);
      
      if (status === "completed") {
        this.stats.completed++;
      } else {
        this.stats.failed++;
      }

      this.calls.delete(uuid);
    }
  },

  recordError(errorType, errorMessage) {
    const key = `${errorType}: ${errorMessage}`;
    this.stats.errors[key] = (this.stats.errors[key] || 0) + 1;
  },

  getStats() {
    const effectiveTotal = this.stats.totalInitiated - this.stats.rateLimited;
    return {
      totalInitiated: this.stats.totalInitiated,
      currentActive: this.stats.currentActive,
      peakConcurrent: this.stats.peakConcurrent,
      completed: this.stats.completed,
      failed: this.stats.failed,
      rateLimited: this.stats.rateLimited,
      successRate: effectiveTotal > 0
        ? ((this.stats.completed / effectiveTotal) * 100).toFixed(2) + "%"
        : "N/A",
      errorBreakdown: this.stats.errors,
    };
  },
};

module.exports = { callTracker };
