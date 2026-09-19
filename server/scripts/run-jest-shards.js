const { spawnSync } = require('child_process');
const path = require('path');

const shardCount = Number(process.env.JEST_SHARDS || 4);
if (!Number.isInteger(shardCount) || shardCount < 1 || shardCount > 20) {
  throw new Error('JEST_SHARDS must be an integer between 1 and 20');
}

const jestBin = path.join(path.dirname(require.resolve('jest')), '..', 'bin', 'jest.js');
for (let shard = 1; shard <= shardCount; shard += 1) {
  console.log(`\n[jest-shards] Running shard ${shard}/${shardCount}`);
  const result = spawnSync(
    process.execPath,
    [jestBin, '--runInBand', '--forceExit', `--shard=${shard}/${shardCount}`],
    { stdio: 'inherit', env: process.env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`\n[jest-shards] All ${shardCount} shards passed`);
