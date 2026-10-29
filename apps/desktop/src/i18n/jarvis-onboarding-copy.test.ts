import { describe, expect, it } from 'vitest'

import { arFirstRun } from './ar_first_run'
import { deFirstRun } from './de_first_run'
import { enFirstRun } from './en_first_run'
import { esFirstRun } from './es_first_run'
import { frFirstRun } from './fr_first_run'
import { jaFirstRun } from './ja_first_run'
import { ruFirstRun } from './ru_first_run'
import { zhHantFirstRun } from './zh-hant_first_run'
import { zhFirstRun } from './zh_first_run'

const greetings = {
  ar: arFirstRun.intro.greeting,
  de: deFirstRun.intro.greeting,
  en: enFirstRun.intro.greeting,
  es: esFirstRun.intro.greeting,
  fr: frFirstRun.intro.greeting,
  ja: jaFirstRun.intro.greeting,
  ru: ruFirstRun.intro.greeting,
  zh: zhFirstRun.intro.greeting,
  'zh-hant': zhHantFirstRun.intro.greeting
}

describe('Jarvis first-run identity', () => {
  it.each(Object.entries(greetings))('%s greets as Jarvis', (_locale, greeting) => {
    expect(greeting).toContain('Jarvis')
    expect(greeting).not.toContain('Hermes')
  })
})
