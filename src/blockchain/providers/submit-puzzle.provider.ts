import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '../../common/logging/logger.service';
import { RedisService } from '../../common/services/redis.service';

// Hypothetical Stellar Soroban SDK import
import { SorobanClient } from 'stellar-sdk';

@Injectable()
export class SubmitPuzzleProvider {
  private readonly rpcUrl: string;
  private readonly contractId: string;
  private readonly oracleSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly logger: Logger,
  ) {
    this.rpcUrl = this.configService.get<string>('SOROBAN_RPC_URL');
    this.contractId = this.configService.get<string>('PUZZLE_CONTRACT_ID');
    this.oracleSecret = this.configService.get<string>('ORACLE_SECRET');
  }

  async submitPuzzleOnChain(
    stellarWallet: string,
    puzzleId: string,
    category: string,
    score: number,
  ): Promise<void> {
    try {
      const server = new SorobanClient.Server(this.rpcUrl);
      const oracleKeypair = SorobanClient.Keypair.fromSecret(this.oracleSecret);

      const tx = new SorobanClient.TransactionBuilder(
        await server.loadAccount(oracleKeypair.publicKey()),
        { fee: SorobanClient.BASE_FEE, networkPassphrase: SorobanClient.Networks.TESTNET },
      )
        .addOperation(
          SorobanClient.Operation.invokeContractFunction({
            contractId: this.contractId,
            function: 'submit_puzzle',
            args: [
              SorobanClient.xdr.ScVal.scvString(stellarWallet),
              SorobanClient.xdr.ScVal.scvString(puzzleId),
              SorobanClient.xdr.ScVal.scvString(category),
              SorobanClient.xdr.ScVal.scvU32(score),
            ],
          }),
        )
        .setTimeout(30)
        .build();

      tx.sign(oracleKeypair);

      await server.sendTransaction(tx);
      this.logger.log(`✅ Puzzle submitted on-chain: wallet=${stellarWallet}, puzzle=${puzzleId}, score=${score}`);
    } catch (error) {
      this.logger.error(
        `❌ Failed to submit puzzle on-chain: wallet=${stellarWallet}, puzzle=${puzzleId}, score=${score}`,
        error.stack,
        {},
      );

      // Push to Redis queue for retry
      await this.redisService.getClient().lpush(
        'failed_puzzle_submissions',
        JSON.stringify({ stellarWallet, puzzleId, category, score }),
      );
    }
  }
}
