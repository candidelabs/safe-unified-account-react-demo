import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'

const REQUIRED_PER_ACCOUNT_CHAIN = ['ID', 'BUNDLER_URL', 'JSON_RPC_PROVIDER', 'PAYMASTER_URL', 'USDT0_TOKEN', 'USDT0_OFT', 'LZ_EID']
const REQUIRED_PER_DEST_CHAIN = ['ID', 'NAME', 'JSON_RPC_PROVIDER', 'EXPLORER_URL', 'USDT0_TOKEN', 'LZ_EID']

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())

  // Account chains — Safe operates here (bundler + paymaster + OFT required)
  let accountChainCount = 0
  for (let n = 1; ; n++) {
    const hasId = !!env[`VITE_CHAIN${n}_ID`]
    if (!hasId) break

    for (const suffix of REQUIRED_PER_ACCOUNT_CHAIN) {
      const key = `VITE_CHAIN${n}_${suffix}`
      if (!env[key]) {
        throw new Error(`Environment variable ${key} is missing`)
      }
    }
    accountChainCount++
  }

  if (accountChainCount < 2) {
    throw new Error(
      `At least 2 account chains must be configured. Found ${accountChainCount}. ` +
      'Set VITE_CHAIN1_ID, VITE_CHAIN1_BUNDLER_URL, VITE_CHAIN1_JSON_RPC_PROVIDER, VITE_CHAIN1_PAYMASTER_URL (and same for CHAIN2+).'
    )
  }

  // Destination-only chains — recipient can receive USDT0 here, but the Safe
  // doesn't run userOps. Optional; zero or more.
  for (let n = 1; ; n++) {
    const hasId = !!env[`VITE_DEST_CHAIN${n}_ID`]
    if (!hasId) break

    for (const suffix of REQUIRED_PER_DEST_CHAIN) {
      const key = `VITE_DEST_CHAIN${n}_${suffix}`
      if (!env[key]) {
        throw new Error(`Environment variable ${key} is missing`)
      }
    }
  }

  return {
    plugins: [react()],
    // Skip Vite's dep pre-bundling for abstractionkit. When it's linked via
    // `file:../abstractionkit`, pre-bundling caches a snapshot that ignores
    // subsequent source edits — leading to confusing "stale bundle" bugs.
    optimizeDeps: {
      exclude: ['abstractionkit'],
    },
  }
})
