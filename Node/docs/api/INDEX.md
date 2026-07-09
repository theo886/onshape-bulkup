# Onshape API Documentation Index

Quick reference for Onshape API endpoints, organized by category.

## Usage for Claude Agents

1. **Find the right category**: Scan the tables below to find the API category you need
2. **Read the category file**: `Read Node/docs/api/{Category}.json`
3. **Find the endpoint**: Search for the operation name (e.g., `getAssemblyDefinition`)
4. **Check parameters**: Look at `parameters` array for required inputs
5. **Check response**: Look at `responses.200.content` for response schema

## Priority Categories (Migration Project)

These are the most commonly used APIs for the SolidWorks migration:

| Category | Endpoints | Size | Description |
|----------|-----------|------|-------------|
| [Assembly](Assembly.json) | 28 | 191KB | Create and manage assemblies. |
| [BlobElement](BlobElement.json) | 5 | 49KB | Create, modify, and translate blob elements. |
| [Document](Document.json) | 36 | 159KB | Create and manage documents. |
| [Element](Element.json) | 8 | 43KB | Access and manage Elements. Every Element in an Onshape document is represented by a tab. |
| [Metadata](Metadata.json) | 11 | 51KB | Access and modify metadata. |
| [Part](Part.json) | 12 | 244KB | Export Parts and access Part details. |
| [PartStudio](PartStudio.json) | 28 | 419KB | Access and modify Part Studios. |
| [ReleasePackage](ReleasePackage.json) | 4 | 47KB | Access and update Release Management workflows. |
| [Revision](Revision.json) | 9 | 43KB | Get revision information. See [API Guide: Release Management](https://onshape-public.github.io/docs/api-adv/relmgmt/) |
| [Translation](Translation.json) | 5 | 22KB | Import and export Onshape surfaces, parts, Part Studios, Assemblies, and subassemblies to/from other file formats (STL, PARASOLID, SOLIDWORKS, etc). |

### Key Operations by Category

- **Assembly**: getNamedViews, createAssembly, getOrCreateBillOfMaterialsElement, updateFeature
- **BlobElement**: uploadFileCreateElement, downloadFileWorkspace, uploadFileUpdateElement, updateUnits
- **Document**: getDocuments, createDocument, downloadExternalData, getDocumentVersions
- **Element**: copyElementFromSourceDocument, encodeConfigurationMap, deleteElement, updateReferences
- **Metadata**: getWMVEsMetadata, getWMVEMetadata, updateWVEMetadata, getFullAssemblyMetadata
- **Part**: getPartsWMV, getPartsWMVE, getBodyDetails, getBoundingBoxes
- **PartStudio**: getPartStudioNamedViews, createPartStudio, updatePartStudioFeature, deletePartStudioFeature
- **ReleasePackage**: createObsoletionPackage, createReleasePackage, getReleasePackage, updateReleasePackage
- **Revision**: getRevisionByPartNumber, enumerateRevisions, getRevisionHistoryInCompanyByElementId, getRevisionHistoryInCompanyByPartId
- **Translation**: getDocumentTranslations, createTranslation, getAllTranslatorFormats, getTranslation

## All Categories

| Category | Endpoints | Size | Description |
|----------|-----------|------|-------------|
| [Account](Account.json) | 4 | 30KB | Manage user purchases, subscriptions, and consumables. |
| [Alias](Alias.json) | 6 | 30KB | Create and manage enterprise aliases. (Enterprise admins only.) |
| [APIApplication](APIApplication.json) | 7 | 17KB | Manage application preferences. |
| [AppAssociativeData](AppAssociativeData.json) | 4 | 21KB | Manage the application-specific metadata that associates application data with Onshape data. |
| [AppElement](AppElement.json) | 27 | 97KB | Access and modify application elements. |
| [Billing](Billing.json) | 1 | 4KB | Get billing plan data for applications. |
| [Comment](Comment.json) | 10 | 34KB | Create, read, update, and delete comments. |
| [Company](Company.json) | 8 | 66KB | Access company information. |
| [Drawing](Drawing.json) | 7 | 64KB | Access, create, and translate drawings. |
| [ExportRule](ExportRule.json) | 1 | 6KB | Access valid export rules. |
| [FeatureStudio](FeatureStudio.json) | 4 | 40KB | Access and manage Feature Studio Elements. |
| [Folder](Folder.json) | 3 | 16KB | Access and modify folder sharing permissions. |
| [Insertable](Insertable.json) | 1 | 15KB | Access the list of things that can be inserted into a document. |
| [Item](Item.json) | 5 | 14KB | Manage non-geometric [items](https://cad.onshape.com/help/Content/Plans/items.htm). (Professional, Educator, and Enterprise accounts only.) |
| [MetadataCategory](MetadataCategory.json) | 1 | 15KB | Access properties associated with metadata categories. |
| [NumberingScheme](NumberingScheme.json) | 1 | 9KB | Manage the set of valid Part numbers. |
| [OpenApi](OpenApi.json) | 2 | 44KB | Get the OpenAPI specification for the Onshape API. |
| [PartNumber](PartNumber.json) | 1 | 9KB | Create valid part numbers. |
| [PropertiesTableTemplate](PropertiesTableTemplate.json) | 5 | 13KB | Create, access, and delete templates for properties tables. |
| [Publication](Publication.json) | 7 | 23KB | Access publication information. |
| [Sketch](Sketch.json) | 3 | 12KB | Access sketch information. |
| [StandardContent](StandardContent.json) | 3 | 12KB | Work with Onshape standard content. |
| [Task](Task.json) | 5 | 60KB | Create, access, and modify Tasks and Action Items. |
| [Team](Team.json) | 3 | 24KB | Access team information. |
| [Thumbnail](Thumbnail.json) | 11 | 34KB | Access, modify, and delete thumbnails. |
| [User](User.json) | 4 | 35KB | Access user information. |
| [Variables](Variables.json) | 7 | 31KB | Create, modify, and access variables. |
| [Version](Version.json) | 1 | 5KB | Get all versions of the Onshape REST APIs. |
| [Webhook](Webhook.json) | 6 | 50KB | Create and manage [webhooks](https://onshape-public.github.io/docs/app-dev/webhook/). |
| [Workflow](Workflow.json) | 5 | 42KB | Access and modify workflows. |

## Common Patterns

### Path Parameters
Most endpoints use these path parameters:
- `did` - Document ID
- `wvm` - Workspace/Version/Microversion type (`w`, `v`, or `m`)
- `wvmid` - Workspace/Version/Microversion ID
- `eid` - Element ID

### Standard URL Pattern
```
/api/v13/{category}/{did}/{wvm}/{wvmid}/e/{eid}
```

### Response Codes
- `200` - Success
- `400` - Bad request (check parameters)
- `401` - Unauthorized (check API key)
- `403` - Forbidden (check permissions)
- `404` - Not found
- `429` - Rate limited (wait and retry)

## Files

| File | Description |
|------|-------------|
| `INDEX.md` | This file |
| `{Category}.json` | OpenAPI spec for each category |
| `_schemas.json` | All schemas (reference only, 500KB+) |

## Regenerating

If the API documentation is updated, regenerate these files:
```bash
node splitApiDocs.js
```
