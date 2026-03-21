// textWorker.ts
// Example implementation for a text-processing worker
export class TextWorker {
  async process(text: string) {
    // Insert concrete text processing logic here
    return { tokens: text.split(/\s+/) };
  }
}
