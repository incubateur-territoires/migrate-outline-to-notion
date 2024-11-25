type Task = {
  pageId: string;
  execute: () => Promise<any>;
};

export class RateLimiter {
  private activeRequests = new Set<string>();
  private queues: Map<string, Task[]> = new Map();
  private globalQueue: Task[] = [];
  private processing = false;
  private readonly maxGlobalConcurrent = 3;

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

    // Find next eligible task
    const taskIndex = this.globalQueue.findIndex(task => 
      !this.activeRequests.has(task.pageId) && 
      this.activeRequests.size < this.maxGlobalConcurrent
    );

    if (taskIndex === -1) {
      this.processing = false;
      return;
    }

    const task = this.globalQueue[taskIndex];
    this.globalQueue.splice(taskIndex, 1);
    
    // Remove from page-specific queue
    const pageQueue = this.queues.get(task.pageId)!;
    pageQueue.shift();
    if (pageQueue.length === 0) {
      this.queues.delete(task.pageId);
    }

    this.activeRequests.add(task.pageId);

    try {
      await task.execute();
    } finally {
      this.activeRequests.delete(task.pageId);
      
      // Continue processing queue
      setImmediate(() => this.processQueue());
    }

    // Process additional requests in parallel if possible
    if (this.globalQueue.length > 0) {
      setImmediate(() => this.processQueue());
    }
  }
} 