const richTextFromMarkdown =
  require("@contentful/rich-text-from-markdown").richTextFromMarkdown;

const _ = require("lodash");

/* 
description is {en-US: text}
description[locale] is text
*/

module.exports = function (migration) {
  migration.transformEntries({
    contentType: "profile",
    from: ["description"],
    to: ["descriptionRichText"],
    transformEntryForLocale: async function (fromFields, locale) {
      if (!fromFields.description) {
        return;
      }

      async function transformDescription(description, locale) {
        const desc = description[locale];
        return await richTextFromMarkdown(desc);
      }

      const richTextDocument = await transformDescription(
        fromFields.description,
        locale
      );

      const richTextDocContent = await richTextDocument.content;

      const result = {
        descriptionRichText: richTextDocContent,
      };

      return result;
    },
  });
};

function example(migration, { makeRequest, spaceId, accessToken }) {
  const managementClient = createClient({ accessToken: accessToken });

  migration.transformEntries({
    contentType: "lesson",
    from: ["modules"],
    to: ["copy"],
    transformEntryForLocale: async function (fromFields, currentLocale) {
      // Get the "Lesson > *" modules that are linked to the "modules" field
      // the modules field itself isn't localized, but some of the links contained in the array point to localizable entries.
      const moduleIDs = fromFields.modules["en-US"].map((e) => e.sys.id);
      const moduleEntries = await makeRequest({
        method: "GET",
        url: `/entries?sys.id[in]=${moduleIDs.join(",")}`,
      });
      // Filter down to just these Lessons linked by the current entry
      const linkedModuleEntries = moduleIDs.map((id) =>
        moduleEntries.items.find((entry) => entry.sys.id === id)
      );

      const allNodeArrays = await Promise.all(
        linkedModuleEntries.map((linkedModule) => {
          return transformLinkedModule(linkedModule, currentLocale);
        })
      );

      // The content property of the Rich Text document is an array of paragraphs, embedded entries, embedded assets.
      const content = _.flatten(allNodeArrays);

      // The returned Rich Text object to be added to the new "copy" field
      var result = {
        copy: {
          nodeType: "document",
          content: content,
          data: {},
        },
      };
      return result;

      async function transformLinkedModule(linkedModule, locale) {
        switch (linkedModule.sys.contentType.sys.id) {
          case "lessonCopy":
            const richTextDocument = await transformLessonCopy(
              linkedModule,
              locale
            );
            return richTextDocument.content;
          case "lessonImage":
            return embedImageBlock(linkedModule);
          case "lessonCodeSnippets":
            return embedCodeSnippet(linkedModule);
        }
      }

      // Return Rich Text instead of Markdown
      async function transformLessonCopy(lessonCopy, locale) {
        const copy = lessonCopy.fields.copy[locale];
        return await richTextFromMarkdown(copy, async (mdNode) => {
          if (mdNode.type !== "image") {
            return null;
          }
          // Create and asset and publish it
          const space = await managementClient.getSpace(spaceId);
          // Unfortunately, we can't pull the environment id from the context
          const environment = await space.getEnvironment(ENV_NAME);

          let asset = await environment.createAsset({
            fields: {
              title: {
                "en-US": mdNode.title
                  ? mdNode.title + locale
                  : mdNode.alt + locale,
              },
              file: {
                "en-US": {
                  contentType: getContentType(mdNode.url),
                  fileName: getFileName(mdNode.url) + locale,
                  upload: `https:${mdNode.url}`,
                },
              },
            },
          });
          asset = await asset.processForAllLocales({
            processingCheckWait: 4000,
          });
          asset = await asset.publish();
          console.log(`published asset's id is ${asset.sys.id}`);
          return {
            nodeType: "embedded-asset-block",
            content: [],
            data: {
              target: {
                sys: {
                  type: "Link",
                  linkType: "Asset",
                  id: asset.sys.id,
                },
              },
            },
          };
        });
      }
      // Return a Rich Text embedded asset object
      function embedImageBlock(lessonImage) {
        // This field is not localized.
        const asset = lessonImage.fields.image["en-US"];
        return [
          {
            nodeType: "embedded-asset-block",
            content: [],
            data: {
              target: {
                sys: {
                  type: "Link",
                  linkType: "Asset",
                  id: asset.sys.id,
                },
              },
            },
          },
        ];
      }
      // Return a Rich Text embedded entry object
      function embedCodeSnippet(lessonCodeSnippet) {
        return [
          {
            nodeType: "embedded-entry-block",
            content: [],
            data: {
              target: {
                sys: {
                  type: "Link",
                  linkType: "Entry",
                  id: lessonCodeSnippet.sys.id,
                },
              },
            },
          },
        ];
      }
    },
  });
}
