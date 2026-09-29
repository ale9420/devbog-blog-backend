/** Labels of `shared.image-credit` values in the federated attribution line. */

export interface LocalizedLabel {
  es: string;
  en: string;
}

export const CREDIT_KINDS: Record<string, LocalizedLabel> = {
  photo: { es: 'Foto', en: 'Photo' },
  illustration: { es: 'Ilustración', en: 'Illustration' },
  diagram: { es: 'Diagrama', en: 'Diagram' },
  screenshot: { es: 'Captura', en: 'Screenshot' },
};

export const LICENSES: Record<string, { label: LocalizedLabel; url?: string }> = {
  'own-work': { label: { es: 'obra propia', en: 'own work' } },
  cc0: {
    label: { es: 'CC0', en: 'CC0' },
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  'public-domain': { label: { es: 'dominio público', en: 'public domain' } },
  'cc-by-4.0': {
    label: { es: 'CC BY 4.0', en: 'CC BY 4.0' },
    url: 'https://creativecommons.org/licenses/by/4.0/',
  },
  'cc-by-sa-4.0': {
    label: { es: 'CC BY-SA 4.0', en: 'CC BY-SA 4.0' },
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  'cc-by-nc-4.0': {
    label: { es: 'CC BY-NC 4.0', en: 'CC BY-NC 4.0' },
    url: 'https://creativecommons.org/licenses/by-nc/4.0/',
  },
  unsplash: {
    label: { es: 'Licencia Unsplash', en: 'Unsplash License' },
    url: 'https://unsplash.com/license',
  },
  permission: { label: { es: 'uso con permiso', en: 'used with permission' } },
  other: { label: { es: 'otra licencia', en: 'other license' } },
};
