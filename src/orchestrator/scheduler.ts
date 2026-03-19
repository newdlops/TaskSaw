export class OrderedDfsScheduler {
  async executeChildrenInOrder<TChild, TResult>(
    children: readonly TChild[],
    executor: (child: TChild, index: number) => Promise<TResult>
  ): Promise<TResult[]> {
    const results: TResult[] = [];

    for (const [index, child] of children.entries()) {
      results.push(await executor(child, index));
    }

    return results;
  }
}
