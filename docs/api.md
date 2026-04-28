# Handl API

Handl exposes a JSON HTTP API that can be used by Postman, scripts, automations, or other integrations.

An OpenAPI specification for the current API surface is available at [docs/openapi.yaml](openapi.yaml).

## Base URL

Local Docker or production server:

```text
http://localhost:3000
```

Vite dev server:

```text
http://localhost:5173
```

The Vite server proxies `/api` and `/uploads` to the API server.

## Authentication

For automation, use API tokens.

Handl accepts either header:

```text
Authorization: Bearer hdl_your_token
```

or:

```text
x-api-key: hdl_your_token
```

The older browser-session header still works for the frontend:

```text
x-user-id: user_uid
```

For new integrations, prefer `Authorization: Bearer`.

## Create An API Token In The GUI

The easiest way to create a token is from the Handl interface:

1. Sign in as an admin.
2. Open **Users** from the sidebar.
3. Scroll to **API Tokens**.
4. Enter a name, for example `Postman` or `Automation script`.
5. Click **Create Token**.
6. Copy the token immediately.

The full token is shown only once. After that, Handl only shows the token prefix, creation date, and last-used date.

Use the copied token in Postman, scripts, or another integration:

```text
Authorization: Bearer hdl_your_token
```

You can revoke old tokens from the same **API Tokens** panel.

## Create An API Token Through The API

First sign in once with your provisioned Handl account:

```http
POST /api/auth/login
Content-Type: application/json
```

```json
{
  "email": "you@example.com",
  "displayName": "Your Name"
}
```

The response contains a `token`. Use that as `x-user-id` only to create your long-lived API token:

```http
POST /api/api-tokens
x-user-id: <login-token>
Content-Type: application/json
```

```json
{
  "name": "Postman"
}
```

The response includes the full API token once:

```json
{
  "id": "token_id",
  "userId": "user_id",
  "name": "Postman",
  "tokenPrefix": "hdl_abc12345",
  "createdAt": "2026-04-23T10:00:00.000Z",
  "lastUsedAt": null,
  "token": "hdl_full_secret_token"
}
```

Store `token` somewhere safe. Handl stores only a SHA-256 hash of it.

## Token Management

List your tokens:

```http
GET /api/api-tokens
Authorization: Bearer hdl_your_token
```

Revoke a token:

```http
DELETE /api/api-tokens/:id
Authorization: Bearer hdl_your_token
```

## Current User

```http
GET /api/auth/me
Authorization: Bearer hdl_your_token
```

## Tickets

List tickets:

```http
GET /api/tickets?filter=all&search=vpn
Authorization: Bearer hdl_your_token
```

Supported `filter` values:

- `all`
- `assigned`
- `archived`
- `created`
- `new`
- `open`
- `in_progress`
- `waiting`
- `resolved`
- `closed`

Get one ticket with its updates:

```http
GET /api/tickets/:id
Authorization: Bearer hdl_your_token
```

Create a ticket:

```http
POST /api/tickets
Authorization: Bearer hdl_your_token
Content-Type: application/json
```

```json
{
  "title": "VPN issue",
  "description": "User cannot connect to VPN.",
  "priority": "high",
  "requesterName": "Alice",
  "requesterEmail": ""
}
```

Update a ticket:

```http
PATCH /api/tickets/:id
Authorization: Bearer hdl_your_token
Content-Type: application/json
```

```json
{
  "status": "waiting",
  "priority": "medium",
  "deadline": "2026-04-24T00:00:00.000Z"
}
```

Delete a ticket:

```http
DELETE /api/tickets/:id
Authorization: Bearer hdl_your_token
```

## Updates

List updates:

```http
GET /api/tickets/:id/comments
Authorization: Bearer hdl_your_token
```

Add an update:

```http
POST /api/tickets/:id/comments
Authorization: Bearer hdl_your_token
Content-Type: application/json
```

```json
{
  "content": "Checked logs and restarted the client.",
  "isInternal": false,
  "attachments": [],
  "sourceType": "manual"
}
```

Edit an update:

```http
PATCH /api/tickets/:ticketId/comments/:commentId
Authorization: Bearer hdl_your_token
Content-Type: application/json
```

```json
{
  "content": "Updated note text."
}
```

Delete an update:

```http
DELETE /api/tickets/:ticketId/comments/:commentId
Authorization: Bearer hdl_your_token
```

## Email Import

Preview an Outlook `.msg` file:

```http
POST /api/email-import-preview
Authorization: Bearer hdl_your_token
Content-Type: multipart/form-data
```

Form field:

```text
file=@mail.msg
```

Import an Outlook `.msg` into an existing ticket:

```http
POST /api/tickets/:id/import-email
Authorization: Bearer hdl_your_token
Content-Type: multipart/form-data
```

Form field:

```text
file=@mail.msg
```

## Attachments

Upload a file:

```http
POST /api/uploads
Authorization: Bearer hdl_your_token
Content-Type: multipart/form-data
```

Form field:

```text
file=@screenshot.png
```

Delete an unlinked uploaded file:

```http
DELETE /api/uploads?url=/uploads/file.png
Authorization: Bearer hdl_your_token
```

Delete a ticket attachment:

```http
DELETE /api/tickets/:ticketId/attachments?url=/uploads/file.png
Authorization: Bearer hdl_your_token
```

## Users

Admin-only:

- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `DELETE /api/users/:id`

Agent/admin list:

```http
GET /api/users/agents
Authorization: Bearer hdl_your_token
```

Requesters:

```http
GET /api/requesters
Authorization: Bearer hdl_your_token
```

## MCP Starter Tool Mapping

A minimal MCP server should start with these tools:

- `handl_search_tickets` -> `GET /api/tickets?filter=all&search=...`
- `handl_get_ticket` -> `GET /api/tickets/:id`
- `handl_create_ticket` -> `POST /api/tickets`
- `handl_add_update` -> `POST /api/tickets/:id/comments`
- `handl_set_status` -> `PATCH /api/tickets/:id`
- `handl_set_priority` -> `PATCH /api/tickets/:id`
- `handl_set_due_date` -> `PATCH /api/tickets/:id`

Recommended MCP environment variables:

```env
HANDL_API_BASE_URL=http://localhost:3000
HANDL_API_TOKEN=hdl_your_token
```
