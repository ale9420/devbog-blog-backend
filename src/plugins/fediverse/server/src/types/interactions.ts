/** Likes and boosts received on articles. */

export type InteractionType = 'like' | 'boost';

export interface InteractionInput {
  type: InteractionType;
  actorId: string;
  handle?: string | null;
  articleDocumentId: string;
}
