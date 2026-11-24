import { scoreNativeMetrics } from './weather-native.ts'
import { NATIVE_METRICS } from '../src/weather/config.ts'

// Private pipe protocol: little-endian byte length, Float32 metrics, score bytes.
// A persistent process keeps every terrain pixel on the popup's scoring function.
let pending = Buffer.alloc(0)
for await (const chunk of process.stdin) {
  pending = Buffer.concat([pending, chunk])
  while (pending.length >= 4) {
    const bytes = pending.readUInt32LE(0)
    if (bytes > 256 * 256 * NATIVE_METRICS.fields.length * Float32Array.BYTES_PER_ELEMENT) throw new Error('Weather scoring frame too large')
    if (pending.length < bytes + 4) break
    process.stdout.write(scoreNativeMetrics(pending.subarray(4, bytes + 4)))
    pending = pending.subarray(bytes + 4)
  }
}
if (pending.length !== 0) throw new Error('Incomplete weather scoring frame')
