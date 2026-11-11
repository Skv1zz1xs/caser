/** npm run gen:sql — пересобирает supabase/seed.sql из src/config/economy.ts */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CATALOG } from '../src/shared/catalog'
import { buildSeedSql } from './lib/seed'

const file = fileURLToPath(new URL('../supabase/seed.sql', import.meta.url))
const sql = buildSeedSql()
writeFileSync(file, sql)
console.log(`supabase/seed.sql обновлён: ${CATALOG.cases.length} кейсов, ${CATALOG.cases.reduce((a, c) => a + c.outcomes.length, 0)} исходов, версия ${CATALOG.version}`)
console.log('Теперь вставь содержимое supabase/seed.sql в Supabase → SQL Editor и нажми Run.')
