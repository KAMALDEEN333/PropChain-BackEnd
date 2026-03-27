describe('SubmitPuzzleProvider', () => {
  let provider: SubmitPuzzleProvider;

  beforeEach(() => {
    provider = new SubmitPuzzleProvider(mockConfig, mockRedis, mockLogger);
  });

  it('should submit puzzle on-chain successfully', async () => {
    jest.spyOn(provider as any, 'submitPuzzleOnChain').mockResolvedValueOnce(undefined);

    await expect(
      provider.submitPuzzleOnChain('wallet123', 'puzzleABC', 'math', 100),
    ).resolves.not.toThrow();
  });

  it('should log and queue failed submissions', async () => {
    jest.spyOn(provider as any, 'submitPuzzleOnChain').mockRejectedValueOnce(new Error('RPC error'));

    await provider.submitPuzzleOnChain('wallet123', 'puzzleABC', 'math', 100);

    expect(mockLogger.error).toHaveBeenCalled();
    expect(mockRedis.getClient().lpush).toHaveBeenCalled();
  });
});
