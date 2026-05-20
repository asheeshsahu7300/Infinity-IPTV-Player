// ============================================================================
// PERFORMANCE MONITORING
// ============================================================================

interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: any;
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private timers = new Map<string, number>();
  private maxMetrics = 1000;

  /**
   * Start timing an operation
   */
  start(name: string): void {
    this.timers.set(name, Date.now());
  }

  /**
   * End timing and record metric
   */
  end(name: string, metadata?: any): number | null {
    const startTime = this.timers.get(name);
    if (!startTime) {
      console.warn(`No start time found for: ${name}`);
      return null;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(name);

    this.recordMetric({
      name,
      duration,
      timestamp: Date.now(),
      metadata,
    });

    return duration;
  }

  /**
   * Measure a function execution
   */
  async measure<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: any
  ): Promise<T> {
    this.start(name);
    try {
      const result = await fn();
      this.end(name, metadata);
      return result;
    } catch (error) {
      this.end(name, { ...metadata, error: true });
      throw error;
    }
  }

  /**
   * Record a metric
   */
  private recordMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);

    // Keep only recent metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // Log slow operations
    if (metric.duration > 2000) {
      console.warn(
        `[PERF] Slow operation detected: ${metric.name} took ${metric.duration}ms`
      );
    }
  }

  /**
   * Get metrics by name
   */
  getMetrics(name?: string): PerformanceMetric[] {
    if (!name) return this.metrics;
    return this.metrics.filter((m) => m.name === name);
  }

  /**
   * Get average duration for a metric
   */
  getAverage(name: string): number {
    const metrics = this.getMetrics(name);
    if (metrics.length === 0) return 0;

    const sum = metrics.reduce((acc, m) => acc + m.duration, 0);
    return sum / metrics.length;
  }

  /**
   * Get performance statistics
   */
  getStats(name?: string): {
    count: number;
    avg: number;
    min: number;
    max: number;
    p95: number;
  } | null {
    const metrics = name ? this.getMetrics(name) : this.metrics;
    if (metrics.length === 0) return null;

    const durations = metrics.map((m) => m.duration).sort((a, b) => a - b);
    const sum = durations.reduce((acc, d) => acc + d, 0);
    const p95Index = Math.floor(durations.length * 0.95);

    return {
      count: metrics.length,
      avg: sum / metrics.length,
      min: durations[0],
      max: durations[durations.length - 1],
      p95: durations[p95Index] || durations[durations.length - 1],
    };
  }

  /**
   * Monitor screen load time
   */
  screenLoadStart(screenName: string): void {
    this.start(`screen:${screenName}`);
  }

  screenLoadEnd(screenName: string): void {
    this.end(`screen:${screenName}`);
  }

  /**
   * Monitor API call
   */
  apiCallStart(endpoint: string): void {
    this.start(`api:${endpoint}`);
  }

  apiCallEnd(endpoint: string, success: boolean = true): void {
    this.end(`api:${endpoint}`, { success });
  }

  /**
   * Monitor render time
   */
  renderStart(component: string): void {
    this.start(`render:${component}`);
  }

  renderEnd(component: string): void {
    this.end(`render:${component}`);
  }

  /**
   * Get summary report
   */
  getSummary(): string {
    const screens = this.getStats("screen");
    const apis = this.getStats("api");
    const renders = this.getStats("render");

    let summary = "=== Performance Summary ===\n\n";

    if (screens) {
      summary += `Screens:\n`;
      summary += `  Avg: ${screens.avg.toFixed(2)}ms\n`;
      summary += `  P95: ${screens.p95.toFixed(2)}ms\n`;
      summary += `  Count: ${screens.count}\n\n`;
    }

    if (apis) {
      summary += `API Calls:\n`;
      summary += `  Avg: ${apis.avg.toFixed(2)}ms\n`;
      summary += `  P95: ${apis.p95.toFixed(2)}ms\n`;
      summary += `  Count: ${apis.count}\n\n`;
    }

    if (renders) {
      summary += `Renders:\n`;
      summary += `  Avg: ${renders.avg.toFixed(2)}ms\n`;
      summary += `  P95: ${renders.p95.toFixed(2)}ms\n`;
      summary += `  Count: ${renders.count}\n`;
    }

    return summary;
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
    this.timers.clear();
  }

  /**
   * Export metrics as JSON
   */
  export(): string {
    return JSON.stringify(this.metrics, null, 2);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const performanceMonitor = new PerformanceMonitor();
