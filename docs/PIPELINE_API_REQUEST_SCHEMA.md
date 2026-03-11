# Pipeline API Request Schema

The pipeline accepts JSON requests only.

## Core Rule
Prompts are exchanged among:
- Codex
- NorthNo1
- DeepSea

The pipeline itself executes structured requests and file operations.

## Common Actions
- `northno1.compose`
- `northno1.send`
- `northno1.new_chat`
- `northno1.fetch_parse`
- `deepsea.list_files`
- `deepsea.download`
- `deepsea.upload_files`
- `deepsea.inspect_chat`
- `deepsea.send`
- `deepsea.fetch_reply`
- `bundle.build`
- `deepsea.push_bundle`

## Example
```json
{
  "action": "northno1.send",
  "params": {
    "messagePath": "papers/paper_default/prompts/to_northno1.md"
  }
}
```

## DeepSea Upload Preference
If a delivery contains multiple related files or a directory tree, prefer bundling first and then pushing the bundle to DeepSea.

## NorthNo1 API Preference
Use a compliant API path for manuscript review and prompt generation. If attachments are large or numerous, prefer bundling them before sending.
