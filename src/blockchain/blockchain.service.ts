// blockchain.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { ProviderFactory } from './providers/provider.factory';
import { SupportedChain } from './enums/supported-chain.enum';
import { SubmitPuzzleProvider } from './providers/submit-puzzle.provider';

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private providers = new Map<SupportedChain, ethers.JsonRpcProvider>();
  constructor(private readonly submitPuzzleProvider: SubmitPuzzleProvider) {
    Object.values(SupportedChain).forEach(chain => {
      this.providers.set(chain, ProviderFactory.create(chain));
    });
  }

  /**
   * Get the blockchain provider for a specific chain
   */
  getProvider(chain: SupportedChain) {
    return this.providers.get(chain);
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(): Promise<number> {
    // In a real application, this would use a provider to estimate fees.
    // For now, return a placeholder value.
    this.logger.log('Estimating gas fees...');
    return 0.0005; // Placeholder value
  }

  /**
   * Create an escrow wallet address
   */
  async createEscrowWallet(): Promise<string> {
    this.logger.log('Creating new escrow wallet...');
    const wallet = ethers.Wallet.createRandom();
    return wallet.address;
  }

  /**
   * Get transaction receipt from blockchain
   */
  async getTransactionReceipt(hash: string): Promise<any> {
    this.logger.log(`Fetching receipt for hash: ${hash}`);
    const provider = this.getProvider(SupportedChain.ETHEREUM);
    if (!provider) {
      throw new Error('Default provider not found');
    }
    const receipt = await provider.getTransactionReceipt(hash);
    return receipt || { confirmations: 0 };
  }

  /**
   * Get current network status for a specific chain
   */
  async getNetworkStatus(chain: SupportedChain) {
    const provider = this.getProvider(chain);
    if (!provider) {
      throw new Error(`Provider not found for chain: ${chain}`);
    }
    const block = await provider.getBlockNumber();

    return {
      chain,
      latestBlock: block,
      healthy: true,
    };
  }

  async submitPuzzleOnChain(
    stellarWallet: string,
    puzzleId: string,
    category: string,
    score: number,
  ): Promise<void> {
    return this.submitPuzzleProvider.submitPuzzleOnChain(stellarWallet, puzzleId, category, score);
  }
}
