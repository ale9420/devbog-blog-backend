# Strapi About Page Migration Guide

This guide documents the backend changes made to the Strapi CMS and provides implementation steps for updating the frontend to consume the new structured About page data.

## Backend Changes Summary

### New Shared Components

Five new Strapi components were added to `src/components/shared/`:

| Component | File | Purpose |
|-----------|------|---------|
| Hero | `hero.json` | Avatar, title, subtitle for page header |
| Topic Card | `topic-card.json` | Icon (enum), title, description for topic sections |
| Social Links | `social-links.json` | Title, description, social media URLs |
| Tech Stack | `tech-stack.json` | Title + repeatable tech items |
| Tech Item | `tech-item.json` | Single technology name |

### Updated About Schema

The About single type now includes:
- **i18n support** (localized content)
- **SEO component** (metaTitle, metaDescription, keywords, canonicalURL)
- **Expanded dynamic zone** with new components:
  - `shared.hero`
  - `shared.rich-text`
  - `shared.quote`
  - `shared.media`
  - `shared.slider`
  - `shared.topic-card`
  - `shared.social-links`
  - `shared.tech-stack`

### API Response Structure

**Endpoint**: `GET /api/about?populate[blocks][populate]=*&populate[seo][populate]=*`

```json
{
  "data": {
    "id": 1,
    "documentId": "w1qe69vhxe73iqrp6zwzj32g",
    "title": "About",
    "locale": "en",
    "seo": {
      "metaTitle": "About - Devbog",
      "metaDescription": "Software developer based in Bogota...",
      "keywords": "about, developer, bogota, colombia, ai, linux, software",
      "metaRobots": "index, follow",
      "metaViewport": "width=device-width, initial-scale=1",
      "canonicalURL": "https://devbog.com/about"
    },
    "blocks": [
      {
        "id": 1,
        "__component": "shared.hero",
        "title": "Alejandro",
        "subtitle": "Software developer based in Bogota, Colombia",
        "avatar": { /* StrapiMediaFile */ }
      },
      {
        "id": 2,
        "__component": "shared.rich-text",
        "body": "Welcome to my blog! I'm a software developer..."
      },
      {
        "id": 3,
        "__component": "shared.topic-card",
        "title": "Artificial Intelligence",
        "description": "Exploring machine learning, LLMs...",
        "icon": "cpu-chip"
      },
      {
        "id": 7,
        "__component": "shared.social-links",
        "title": "Connect",
        "description": "Feel free to reach out...",
        "linkedin": "https://linkedin.com/in/ale9420",
        "github": "https://github.com/ale9420",
        "codeberg": "https://codeberg.org/ale9420",
        "mastodon": "https://mastodon.social/@ale9420"
      },
      {
        "id": 8,
        "__component": "shared.tech-stack",
        "title": "Tech Stack",
        "technologies": [
          { "id": 1, "name": "Vue.js" },
          { "id": 2, "name": "Nuxt" },
          { "id": 3, "name": "TypeScript" }
        ]
      }
    ]
  },
  "meta": {}
}
```

## Frontend Implementation Steps

### 1. Add TypeScript Types

**File**: `app/interfaces/strapi-blocks.ts`

Add new interfaces for the About page components:

```typescript
export interface StrapiHero {
  id: number
  __component: 'shared.hero'
  title: string
  subtitle?: string
  avatar?: StrapiMediaFile
}

export interface StrapiTopicCard {
  id: number
  __component: 'shared.topic-card'
  title: string
  description?: string
  icon: 'cpu-chip' | 'code-bracket' | 'command-line' | 'cloud' | 'book-open' | 'globe' | 'shield-check' | 'rocket'
}

export interface StrapiSocialLinks {
  id: number
  __component: 'shared.social-links'
  title?: string
  description?: string
  linkedin?: string
  github?: string
  codeberg?: string
  mastodon?: string
  twitter?: string
}

export interface StrapiTechItem {
  id: number
  name: string
}

export interface StrapiTechStack {
  id: number
  __component: 'shared.tech-stack'
  title?: string
  technologies: StrapiTechItem[]
}

export type StrapiBlock =
  | StrapiRichText
  | StrapiQuote
  | StrapiMedia
  | StrapiSlider
  | StrapiHero
  | StrapiTopicCard
  | StrapiSocialLinks
  | StrapiTechStack
```

**File**: `app/interfaces/strapi-about.ts` (new)

```typescript
import type { StrapiBlock } from './strapi-blocks'

export interface StrapiAboutSEO {
  metaTitle: string
  metaDescription: string
  keywords?: string
  metaRobots?: string
  metaViewport?: string
  canonicalURL?: string
}

export interface StrapiAbout {
  id: number
  documentId: string
  title: string
  locale: string
  seo?: StrapiAboutSEO
  blocks: StrapiBlock[]
}
```

**File**: `app/interfaces/index.ts`

```typescript
export * from './strapi-about'
```

### 2. Create Server API Route

**File**: `server/api/about.get.ts` (new)

```typescript
import qs from 'qs'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const config = useRuntimeConfig()
  const locale = query.locale as string | undefined

  const params = qs.stringify({
    locale,
    populate: {
      blocks: {
        on: {
          'shared.hero': { populate: '*' },
          'shared.rich-text': { populate: '*' },
          'shared.quote': { populate: '*' },
          'shared.media': { populate: '*' },
          'shared.slider': { populate: '*' },
          'shared.topic-card': { populate: '*' },
          'shared.social-links': { populate: '*' },
          'shared.tech-stack': { populate: '*' },
        },
      },
      seo: { populate: '*' },
    },
  }, { skipNulls: true })

  const headers: Record<string, string> = {}
  if (config.strapiApiToken) {
    headers['Authorization'] = `Bearer ${config.strapiApiToken}`
  }

  setHeader(event, 'Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')

  const response = await $fetch(`${config.public.strapiUrl}/api/about?${params}`, { headers })

  const data = (response as any).data
  if (!data) {
    throw createError({ statusCode: 404, message: 'About page not found' })
  }

  return data
})
```

### 3. Add Composable for Fetching About Data

**File**: `app/composables/useStrapi.ts`

Add to existing file:

```typescript
import type { StrapiAbout } from '~/interfaces'

export const useFetchAbout = (locale?: string) => {
  return useAsyncData<StrapiAbout>(
    `about-${locale || 'default'}`,
    () => $fetch('/api/about', {
      query: locale ? { locale } : {}
    })
  )
}
```

### 4. Create New Block Components

**File**: `app/components/strapi/HeroBlock.vue` (new)

```vue
<script setup lang="ts">
import type { StrapiHero } from '~/interfaces'

defineProps<{
  block: StrapiHero
}>()

const { getMediaUrl } = useStrapi()
</script>

<template>
  <div class="text-center mb-12">
    <div
      v-if="block.avatar"
      class="w-32 h-32 mx-auto mb-6 rounded-full overflow-hidden shadow-lg"
    >
      <NuxtImg
        :src="getMediaUrl(block.avatar.url)"
        :alt="block.avatar.alternativeText || block.title"
        class="w-full h-full object-cover"
      />
    </div>
    <div
      v-else
      class="w-32 h-32 mx-auto mb-6 rounded-full gradient-bogota flex items-center justify-center text-white text-6xl font-display font-bold shadow-lg"
    >
      {{ block.title.charAt(0) }}
    </div>
    <h1 class="font-display text-4xl lg:text-5xl font-bold mb-4">
      {{ block.title }}
    </h1>
    <p v-if="block.subtitle" class="text-xl text-[var(--muted)]">
      {{ block.subtitle }}
    </p>
  </div>
</template>
```

**File**: `app/components/strapi/TopicCardBlock.vue` (new)

```vue
<script setup lang="ts">
import type { StrapiTopicCard } from '~/interfaces'

defineProps<{
  block: StrapiTopicCard
}>()

const iconMap: Record<string, string> = {
  'cpu-chip': 'i-heroicons-cpu-chip',
  'code-bracket': 'i-heroicons-code-bracket',
  'command-line': 'i-heroicons-command-line',
  'cloud': 'i-heroicons-cloud',
  'book-open': 'i-heroicons-book-open',
  'globe': 'i-heroicons-globe-alt',
  'shield-check': 'i-heroicons-shield-check',
  'rocket': 'i-heroicons-rocket-launch',
}

const colorMap: Record<string, string> = {
  'cpu-chip': 'var(--primary)',
  'code-bracket': 'var(--secondary)',
  'command-line': 'green-500',
  'cloud': 'blue-500',
}
</script>

<template>
  <div class="p-4 rounded-lg bg-[var(--surface-elevated)]">
    <div
      class="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
      :style="{ backgroundColor: `color-mix(in srgb, ${colorMap[block.icon] || 'var(--primary)'} 10%, transparent)` }"
    >
      <UIcon
        :name="iconMap[block.icon] || 'i-heroicons-question-mark-circle'"
        class="w-5 h-5"
        :style="{ color: colorMap[block.icon] || 'var(--primary)' }"
      />
    </div>
    <h3 class="font-semibold mb-1">{{ block.title }}</h3>
    <p v-if="block.description" class="text-sm text-[var(--muted)]">
      {{ block.description }}
    </p>
  </div>
</template>
```

**File**: `app/components/strapi/SocialLinksBlock.vue` (new)

```vue
<script setup lang="ts">
import type { StrapiSocialLinks } from '~/interfaces'

defineProps<{
  block: StrapiSocialLinks
}>()
</script>

<template>
  <div class="mt-6">
    <h2 v-if="block.title" class="mt-6">{{ block.title }}</h2>
    <p v-if="block.description">{{ block.description }}</p>
    <div class="flex flex-wrap gap-4 not-prose mt-2">
      <a
        v-if="block.linkedin"
        :href="block.linkedin"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--surface-elevated)] hover:bg-[var(--brand-linkedin)] hover:text-white transition-colors"
      >
        <IconsLinkedInIcon />
        LinkedIn
      </a>
      <a
        v-if="block.github"
        :href="block.github"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--surface-elevated)] hover:bg-[var(--brand-github)] hover:text-white transition-colors"
      >
        <IconsGitHubIcon class="w-5 h-5" />
        GitHub
      </a>
      <a
        v-if="block.codeberg"
        :href="block.codeberg"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--surface-elevated)] hover:bg-[var(--brand-codeberg)] hover:text-white transition-all"
      >
        <IconsCodebergIcon />
        Codeberg
      </a>
      <a
        v-if="block.mastodon"
        :href="block.mastodon"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--surface-elevated)] hover:bg-[var(--brand-mastodon)] hover:text-white transition-colors"
      >
        <IconsMastodonIcon />
        Mastodon
      </a>
      <a
        v-if="block.twitter"
        :href="block.twitter"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--surface-elevated)] hover:bg-[var(--brand-twitter)] hover:text-white transition-colors"
      >
        <UIcon name="i-simple-icons-x" class="w-5 h-5" />
        Twitter
      </a>
    </div>
  </div>
</template>
```

**File**: `app/components/strapi/TechStackBlock.vue` (new)

```vue
<script setup lang="ts">
import type { StrapiTechStack } from '~/interfaces'

defineProps<{
  block: StrapiTechStack
}>()
</script>

<template>
  <div class="card p-8 gradient-bogota-subtle">
    <h3 v-if="block.title" class="font-display text-xl font-semibold mb-4">
      {{ block.title }}
    </h3>
    <div class="flex flex-wrap gap-2">
      <span
        v-for="tech in block.technologies"
        :key="tech.id"
        class="px-3 py-1.5 rounded-full text-sm bg-[var(--surface)] border border-[var(--border)]"
      >
        {{ tech.name }}
      </span>
    </div>
  </div>
</template>
```

### 5. Update BlocksRenderer Component

**File**: `app/components/strapi/BlocksRenderer.vue`

```vue
<script setup lang="ts">
import type { StrapiBlock } from '~/interfaces'
import type { Component } from 'vue'
import StrapiRichTextBlock from '~/components/strapi/RichTextBlock.vue'
import StrapiQuoteBlock from '~/components/strapi/QuoteBlock.vue'
import StrapiMediaBlock from '~/components/strapi/MediaBlock.vue'
import StrapiSliderBlock from '~/components/strapi/SliderBlock.vue'
import StrapiHeroBlock from '~/components/strapi/HeroBlock.vue'
import StrapiTopicCardBlock from '~/components/strapi/TopicCardBlock.vue'
import StrapiSocialLinksBlock from '~/components/strapi/SocialLinksBlock.vue'
import StrapiTechStackBlock from '~/components/strapi/TechStackBlock.vue'

defineProps<{
  blocks: StrapiBlock[]
}>()

const componentMap: Record<string, Component> = {
  'shared.rich-text': StrapiRichTextBlock,
  'shared.quote': StrapiQuoteBlock,
  'shared.media': StrapiMediaBlock,
  'shared.slider': StrapiSliderBlock,
  'shared.hero': StrapiHeroBlock,
  'shared.topic-card': StrapiTopicCardBlock,
  'shared.social-links': StrapiSocialLinksBlock,
  'shared.tech-stack': StrapiTechStackBlock,
}
</script>

<template>
  <template v-for="block in blocks" :key="block.id">
    <component
      :is="componentMap[block.__component]"
      v-if="componentMap[block.__component]"
      :block="block"
    />
    <div
      v-else
      class="text-[var(--muted)] text-sm italic my-4 p-4 border border-[var(--border)] rounded"
    >
      Unknown block type: {{ block.__component }}
    </div>
  </template>
</template>
```

### 6. Rewrite About Page

**File**: `app/pages/about.vue`

```vue
<script setup lang="ts">
const { locale } = useI18n()
const { localizePath } = useLocaleUtils()
const { siteUrl } = useSiteUrl()
const { canonicalUrl } = useCanonicalUrl('/about')

const { data: about, pending } = await useFetchAbout(locale.value)

useSeoMeta({
  title: () => about.value?.seo?.metaTitle || 'About - Devbog',
  ogTitle: () => about.value?.seo?.metaTitle || 'About - Devbog',
  description: () => about.value?.seo?.metaDescription || '',
  ogDescription: () => about.value?.seo?.metaDescription || '',
  ogImage: '/og-image.png',
  ogUrl: () => canonicalUrl.value,
  ogType: 'profile',
  twitterCard: 'summary',
  twitterTitle: () => about.value?.seo?.metaTitle || 'About - Devbog',
  twitterDescription: () => about.value?.seo?.metaDescription || '',
})

useHead({
  link: [
    {
      rel: 'canonical',
      href: () => about.value?.seo?.canonicalURL || canonicalUrl.value,
    },
  ],
})
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
    <div v-if="pending" class="animate-pulse space-y-4">
      <div class="h-32 bg-[var(--surface-elevated)] rounded"></div>
      <div class="h-64 bg-[var(--surface-elevated)] rounded"></div>
    </div>

    <template v-else-if="about">
      <StrapiBlocksRenderer :blocks="about.blocks" />
    </template>

    <div v-else class="text-center text-[var(--muted)]">
      <p>About page content not available.</p>
    </div>
  </div>
</template>
```

### 7. Handle Topic Cards Grid Layout

The current frontend renders topic cards in a 2-column grid. To achieve this with the block renderer, you have two options:

**Option A: Group consecutive topic cards in BlocksRenderer**

Modify `BlocksRenderer.vue` to detect consecutive `shared.topic-card` blocks and wrap them in a grid:

```vue
<script setup lang="ts">
import type { StrapiBlock, StrapiTopicCard } from '~/interfaces'

const props = defineProps<{
  blocks: StrapiBlock[]
}>()

const groupedBlocks = computed(() => {
  const groups: Array<{ type: 'single' | 'topic-grid'; blocks: StrapiBlock[] }> = []
  let currentGroup: StrapiBlock[] = []

  for (const block of props.blocks) {
    if (block.__component === 'shared.topic-card') {
      currentGroup.push(block)
    } else {
      if (currentGroup.length > 0) {
        groups.push({ type: 'topic-grid', blocks: [...currentGroup] })
        currentGroup = []
      }
      groups.push({ type: 'single', blocks: [block] })
    }
  }

  if (currentGroup.length > 0) {
    groups.push({ type: 'topic-grid', blocks: currentGroup })
  }

  return groups
})
</script>

<template>
  <template v-for="(group, index) in groupedBlocks" :key="index">
    <div v-if="group.type === 'topic-grid'" class="grid sm:grid-cols-2 gap-4 not-prose my-6">
      <StrapiTopicCardBlock
        v-for="block in group.blocks"
        :key="block.id"
        :block="block"
      />
    </div>
    <template v-else>
      <component
        v-for="block in group.blocks"
        :key="block.id"
        :is="componentMap[block.__component]"
        v-if="componentMap[block.__component]"
        :block="block"
      />
    </template>
  </template>
</template>
```

**Option B: Use CSS grid on parent container**

Wrap the BlocksRenderer in a container that applies grid to topic cards:

```vue
<!-- In about.vue -->
<div class="prose-custom [&_.topic-card-wrapper]:col-span-1">
  <StrapiBlocksRenderer :blocks="about.blocks" />
</div>
```

And in `TopicCardBlock.vue`, add a wrapper class that the parent can target.

### 8. Update Route Rules (Optional)

**File**: `nuxt.config.ts`

The about page is currently prerendered. With dynamic Strapi data, you may want to adjust:

```typescript
routeRules: {
  '/about': { isr: 3600 }, // Revalidate every hour instead of prerender
  // or keep prerender and trigger rebuild on Strapi content update
}
```

### 9. Remove i18n Keys (Optional)

The following i18n keys are no longer needed if the About page is fully Strapi-driven:

```
about.title
about.developer
about.welcome
about.background
about.bogotaBased
about.whatIWriteAbout
about.artificialIntelligence
about.aiDescription
about.softwareDevelopment
about.softwareDescription
about.linuxOpenSource
about.linuxDescription
about.devopsCloud
about.devopsDescription
about.connect
about.feelFree
about.techStack
```

You can remove these from `i18n/locales/en.json` and `i18n/locales/es.json`, or keep them as fallbacks.

### 10. Testing Checklist

- [ ] Verify `/api/about` returns data with all block types
- [ ] Check that topic cards render in a 2-column grid on desktop
- [ ] Verify social links open in new tabs with correct hover styles
- [ ] Test tech stack pills render with correct styling
- [ ] Confirm SEO meta tags are populated from Strapi data
- [ ] Test locale switching (if i18n enabled on About in Strapi)
- [ ] Verify loading state displays while fetching
- [ ] Check fallback behavior if Strapi is unavailable

## Migration Strategy

### Phase 1: Backend Ready ✅
- Strapi components created
- About schema updated
- Seed data populated

### Phase 2: Frontend Implementation
1. Add TypeScript types
2. Create server API route
3. Add `useFetchAbout` composable
4. Create new block components
5. Update BlocksRenderer
6. Rewrite about.vue

### Phase 3: Cleanup
1. Remove unused i18n keys
2. Update route rules if needed
3. Remove hardcoded `techStack` array
4. Update tests if any

## Notes

- The `shared.hero` component's avatar is optional; the component falls back to displaying the first letter of the title
- Topic card icons use a predefined enum; map these to Heroicons in the frontend
- Social links are optional fields; only render links that exist
- The tech stack uses a repeatable component; render as a simple list of pills
- SEO data from Strapi takes precedence over hardcoded values
