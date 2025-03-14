import logger from "./logger";

type Task = {
  pageId: string;
  execute: () => Promise<any>;
};

export class RateLimiter {
  private activeRequests = new Set<string>();
  private queues: Map<string, Task[]> = new Map();
  private globalQueue: Task[] = [];
  private processing = false;
  private readonly maxGlobalConcurrent = 10;
  private readonly rateWindowMs = 10000;
  private executionTimestamps: number[] = [];

  async add<T>(pageId: string, task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const wrappedTask: Task = {
        pageId,
        execute: async () => {
          try {
            const result = await task();
            resolve(result);
          } catch (error) {
            reject(error);
          }
        }
      };

      if (!this.queues.has(pageId)) {
        this.queues.set(pageId, []);
      }
      
      this.queues.get(pageId)!.push(wrappedTask);
      this.globalQueue.push(wrappedTask);
      
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue() {
    if (this.globalQueue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;

    const now = Date.now();
    this.executionTimestamps = this.executionTimestamps.filter(
      timestamp => timestamp > now - this.rateWindowMs
    );

    if (this.executionTimestamps.length >= this.maxGlobalConcurrent) {
      setTimeout(() => this.processQueue(), 100);
      return;
    }

    const taskIndex = this.globalQueue.findIndex(task => 
      !this.activeRequests.has(task.pageId)
    );

    if (taskIndex === -1) {
      this.processing = false;
      return;
    }

    const task = this.globalQueue[taskIndex];
    this.globalQueue.splice(taskIndex, 1);
    
    const pageQueue = this.queues.get(task.pageId)!;
    pageQueue.shift();
    if (pageQueue.length === 0) {
      this.queues.delete(task.pageId);
    }

    this.activeRequests.add(task.pageId);
    //logger.info(`Starting new task for page ${task.pageId}. Active requests: ${this.activeRequests.size} / ${this.globalQueue.length}`);

    const startTime = Date.now();
    try {
      await task.execute();
      const executionTime = Date.now() - startTime;
      //logger.info(`Completed task for page ${task.pageId} in ${executionTime}ms`);
      this.executionTimestamps.push(Date.now());
    } finally {
      this.activeRequests.delete(task.pageId);
      
      setImmediate(() => this.processQueue());
    }

    if (this.globalQueue.length > 0) {
      setImmediate(() => this.processQueue());
    }
  }

  getTasksPerSecond(periodInSeconds: number): number {
    const now = Date.now();
    const cutoffTime = now - (periodInSeconds * 1000);
    
    const recentExecutions = this.executionTimestamps.filter(
      timestamp => timestamp > cutoffTime
    ).length;
    
    return recentExecutions / periodInSeconds;
  }

  getActiveRequestsCount(): number {
    return this.activeRequests.size;
  }
} 
