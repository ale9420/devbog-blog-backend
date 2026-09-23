// Adds the fields needed to store fediverse replies as comments.
//
// This is a `strapi-server` extension rather than an extension `schema.json`
// because Strapi merges schema files shallowly (`{ ...original, ...extension }`):
// a schema.json declaring `attributes` would replace every attribute of the
// comments plugin, silently breaking it on the next plugin upgrade.
interface CommentsPlugin {
  contentTypes: {
    comment: { schema: { attributes: Record<string, unknown> } };
  };
}

export default (plugin: CommentsPlugin) => {
  const { schema } = plugin.contentTypes.comment;

  schema.attributes = {
    ...schema.attributes,
    // Remote Note id: dedupes redelivered activities and resolves reply threads.
    fediverseUri: { type: 'string', unique: true, configurable: false },
    // `@user@host` of the remote author, for a "from the fediverse" badge.
    fediverseActorHandle: { type: 'string', configurable: false },
  };

  return plugin;
};
