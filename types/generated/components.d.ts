import type { Schema, Struct } from '@strapi/strapi';

export interface AboutContact extends Struct.ComponentSchema {
  collectionName: 'components_about_contacts';
  info: {
    description: 'Contact block with the fediverse account, an extra link and social profiles';
    displayName: 'Contact';
    icon: 'paperPlane';
  };
  attributes: {
    extraLink: Schema.Attribute.Component<'about.link', false>;
    eyebrow: Schema.Attribute.String;
    fediverseHandle: Schema.Attribute.String;
    fediverseLabel: Schema.Attribute.String;
    fediverseLink: Schema.Attribute.Component<'about.link', false>;
    socials: Schema.Attribute.Component<'about.contact-link', true>;
    title: Schema.Attribute.String;
  };
}

export interface AboutContactLink extends Struct.ComponentSchema {
  collectionName: 'components_about_contact_links';
  info: {
    description: 'A social profile shown in the contact list';
    displayName: 'Contact link';
    icon: 'message';
  };
  attributes: {
    handle: Schema.Attribute.String & Schema.Attribute.Required;
    network: Schema.Attribute.String & Schema.Attribute.Required;
    url: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface AboutFact extends Struct.ComponentSchema {
  collectionName: 'components_about_facts';
  info: {
    description: 'A label and value pair for a field-guide style list';
    displayName: 'Fact';
    icon: 'bulletList';
  };
  attributes: {
    label: Schema.Attribute.String & Schema.Attribute.Required;
    mono: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    value: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface AboutItem extends Struct.ComponentSchema {
  collectionName: 'components_about_items';
  info: {
    description: 'A short item with an optional title; the text supports inline Markdown links';
    displayName: 'Item';
    icon: 'feather';
  };
  attributes: {
    text: Schema.Attribute.Text & Schema.Attribute.Required;
    title: Schema.Attribute.String;
  };
}

export interface AboutLink extends Struct.ComponentSchema {
  collectionName: 'components_about_links';
  info: {
    description: 'A labelled link with a button style';
    displayName: 'Link';
    icon: 'link';
  };
  attributes: {
    label: Schema.Attribute.String & Schema.Attribute.Required;
    url: Schema.Attribute.String & Schema.Attribute.Required;
    variant: Schema.Attribute.Enumeration<['primary', 'secondary', 'text']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'text'>;
  };
}

export interface AboutOpenSource extends Struct.ComponentSchema {
  collectionName: 'components_about_open_sources';
  info: {
    description: 'Open source note with a code snippet and a short guide';
    displayName: 'Open source';
    icon: 'github';
  };
  attributes: {
    code: Schema.Attribute.Text;
    eyebrow: Schema.Attribute.String;
    guide: Schema.Attribute.Component<'about.item', true>;
    guideTitle: Schema.Attribute.String;
    text: Schema.Attribute.Text;
  };
}

export interface AboutPrinciples extends Struct.ComponentSchema {
  collectionName: 'components_about_principle_lists';
  info: {
    description: 'Numbered list of principles';
    displayName: 'Principles';
    icon: 'check';
  };
  attributes: {
    eyebrow: Schema.Attribute.String;
    principles: Schema.Attribute.Component<'about.item', true>;
    title: Schema.Attribute.String;
  };
}

export interface AboutProfile extends Struct.ComponentSchema {
  collectionName: 'components_about_profiles';
  info: {
    description: 'Field card: greeting, key facts, calls to action and the plate with a photo';
    displayName: 'Profile';
    icon: 'user';
  };
  attributes: {
    caption: Schema.Attribute.String;
    eyebrow: Schema.Attribute.String;
    facts: Schema.Attribute.Component<'about.fact', true>;
    lead: Schema.Attribute.Text;
    links: Schema.Attribute.Component<'about.link', true>;
    photo: Schema.Attribute.Media<'images'>;
    plateCoordinates: Schema.Attribute.String;
    plateLabel: Schema.Attribute.String;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface AboutProject extends Struct.ComponentSchema {
  collectionName: 'components_about_projects';
  info: {
    description: 'A project card; the featured one gets the large layout';
    displayName: 'Project';
    icon: 'code';
  };
  attributes: {
    description: Schema.Attribute.Text;
    eyebrow: Schema.Attribute.String;
    facts: Schema.Attribute.Component<'about.fact', true>;
    featured: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    links: Schema.Attribute.Component<'about.link', true>;
    meta: Schema.Attribute.String;
    stack: Schema.Attribute.Component<'shared.tech-item', true>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    visual: Schema.Attribute.Enumeration<['none', 'fediverse', 'palette']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'none'>;
    visualCaption: Schema.Attribute.String;
  };
}

export interface AboutProjects extends Struct.ComponentSchema {
  collectionName: 'components_about_project_lists';
  info: {
    description: 'Project list with one featured project';
    displayName: 'Projects';
    icon: 'briefcase';
  };
  attributes: {
    anchor: Schema.Attribute.String;
    eyebrow: Schema.Attribute.String;
    intro: Schema.Attribute.Text;
    projects: Schema.Attribute.Component<'about.project', true>;
    title: Schema.Attribute.String;
  };
}

export interface AboutStatement extends Struct.ComponentSchema {
  collectionName: 'components_about_statements';
  info: {
    description: 'A large statement with supporting text';
    displayName: 'Statement';
    icon: 'quote';
  };
  attributes: {
    body: Schema.Attribute.Text;
    eyebrow: Schema.Attribute.String;
    statement: Schema.Attribute.Text & Schema.Attribute.Required;
  };
}

export interface AboutTopic extends Struct.ComponentSchema {
  collectionName: 'components_about_topics';
  info: {
    description: 'One of the five blog topics with its own description';
    displayName: 'Topic';
    icon: 'layer';
  };
  attributes: {
    category: Schema.Attribute.Enumeration<['privacidad', 'diy', 'ia', 'software', 'linux']> &
      Schema.Attribute.Required;
    description: Schema.Attribute.Text;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface AboutTopics extends Struct.ComponentSchema {
  collectionName: 'components_about_topic_lists';
  info: {
    description: 'The five blog topics with a short description each';
    displayName: 'Topics';
    icon: 'grid';
  };
  attributes: {
    eyebrow: Schema.Attribute.String;
    footnote: Schema.Attribute.String;
    footnoteLabel: Schema.Attribute.String;
    intro: Schema.Attribute.Text;
    title: Schema.Attribute.String;
    topics: Schema.Attribute.Component<'about.topic', true>;
  };
}

export interface SharedHero extends Struct.ComponentSchema {
  collectionName: 'components_shared_heroes';
  info: {
    description: 'Hero section with avatar, title, and subtitle';
    displayName: 'Hero';
    icon: 'user';
  };
  attributes: {
    avatar: Schema.Attribute.Media<'images'>;
    subtitle: Schema.Attribute.String;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SharedMedia extends Struct.ComponentSchema {
  collectionName: 'components_shared_media';
  info: {
    displayName: 'Media';
    icon: 'file-video';
  };
  attributes: {
    file: Schema.Attribute.Media<'images' | 'files' | 'videos'>;
  };
}

export interface SharedMetaSocial extends Struct.ComponentSchema {
  collectionName: 'components_shared_meta_socials';
  info: {
    description: '';
    displayName: 'metaSocial';
    icon: 'project-diagram';
  };
  attributes: {
    description: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
    image: Schema.Attribute.Media<'images' | 'files' | 'videos'>;
    socialNetwork: Schema.Attribute.Enumeration<['Facebook', 'Twitter']> &
      Schema.Attribute.Required;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 70;
      }>;
  };
}

export interface SharedQuote extends Struct.ComponentSchema {
  collectionName: 'components_shared_quotes';
  info: {
    displayName: 'Quote';
    icon: 'indent';
  };
  attributes: {
    body: Schema.Attribute.Text;
    title: Schema.Attribute.String;
  };
}

export interface SharedRichText extends Struct.ComponentSchema {
  collectionName: 'components_shared_rich_texts';
  info: {
    description: '';
    displayName: 'Rich text';
    icon: 'align-justify';
  };
  attributes: {
    body: Schema.Attribute.RichText;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    description: '';
    displayName: 'seo';
    icon: 'search';
  };
  attributes: {
    canonicalURL: Schema.Attribute.String;
    keywords: Schema.Attribute.Text;
    metaDescription: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
        minLength: 50;
      }>;
    metaImage: Schema.Attribute.Media<'images' | 'files' | 'videos'> & Schema.Attribute.Required;
    metaRobots: Schema.Attribute.String;
    metaSocial: Schema.Attribute.Component<'shared.meta-social', true>;
    metaTitle: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 60;
      }>;
    metaViewport: Schema.Attribute.String;
    structuredData: Schema.Attribute.JSON;
  };
}

export interface SharedSlider extends Struct.ComponentSchema {
  collectionName: 'components_shared_sliders';
  info: {
    description: '';
    displayName: 'Slider';
    icon: 'address-book';
  };
  attributes: {
    files: Schema.Attribute.Media<'images', true>;
  };
}

export interface SharedSocialLinks extends Struct.ComponentSchema {
  collectionName: 'components_shared_social_links';
  info: {
    description: 'Section with social media links';
    displayName: 'Social Links';
    icon: 'share';
  };
  attributes: {
    codeberg: Schema.Attribute.String;
    description: Schema.Attribute.Text;
    github: Schema.Attribute.String;
    linkedin: Schema.Attribute.String;
    mastodon: Schema.Attribute.String;
    title: Schema.Attribute.String;
    twitter: Schema.Attribute.String;
  };
}

export interface SharedTechItem extends Struct.ComponentSchema {
  collectionName: 'components_shared_tech_items';
  info: {
    description: 'A single technology name';
    displayName: 'Tech Item';
    icon: 'tag';
  };
  attributes: {
    name: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SharedTechStack extends Struct.ComponentSchema {
  collectionName: 'components_shared_tech_stacks';
  info: {
    description: 'Section displaying a list of technologies';
    displayName: 'Tech Stack';
    icon: 'stack';
  };
  attributes: {
    technologies: Schema.Attribute.Component<'shared.tech-item', true>;
    title: Schema.Attribute.String;
  };
}

export interface SharedTopicCard extends Struct.ComponentSchema {
  collectionName: 'components_shared_topic_cards';
  info: {
    description: 'A topic card with icon, title, and description';
    displayName: 'Topic Card';
    icon: 'layer-group';
  };
  attributes: {
    description: Schema.Attribute.Text;
    icon: Schema.Attribute.Enumeration<
      [
        'cpu-chip',
        'code-bracket',
        'command-line',
        'cloud',
        'book-open',
        'globe',
        'shield-check',
        'rocket',
      ]
    > &
      Schema.Attribute.Required;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'about.contact': AboutContact;
      'about.contact-link': AboutContactLink;
      'about.fact': AboutFact;
      'about.item': AboutItem;
      'about.link': AboutLink;
      'about.open-source': AboutOpenSource;
      'about.principles': AboutPrinciples;
      'about.profile': AboutProfile;
      'about.project': AboutProject;
      'about.projects': AboutProjects;
      'about.statement': AboutStatement;
      'about.topic': AboutTopic;
      'about.topics': AboutTopics;
      'shared.hero': SharedHero;
      'shared.media': SharedMedia;
      'shared.meta-social': SharedMetaSocial;
      'shared.quote': SharedQuote;
      'shared.rich-text': SharedRichText;
      'shared.seo': SharedSeo;
      'shared.slider': SharedSlider;
      'shared.social-links': SharedSocialLinks;
      'shared.tech-item': SharedTechItem;
      'shared.tech-stack': SharedTechStack;
      'shared.topic-card': SharedTopicCard;
    }
  }
}
