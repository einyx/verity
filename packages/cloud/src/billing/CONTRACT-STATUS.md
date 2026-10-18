# Billing contract status

Status of the routes the console expects from the Cloud API (`@logto/cloud` contract).

## Implemented

- `GET /api/tenants/:tenantId/subscription`, `GET /api/tenants/:tenantId/invoices`
- `GET /api/skus`, invitation routes
- `POST /api/checkout-session`, `GET /api/checkout-session/:id`
- `POST /api/tenants/:tenantId/stripe-customer-portal`
- `GET /api/tenants/:tenantId/stripe-customer`, `PUT /api/tenants/:tenantId/stripe-customer` (clear, or re-select the recorded customer only)
- `GET /api/me/stripe-customers`, `PATCH /api/me/stripe-customers/:customerId`
- `POST /api/webhooks/stripe`
- `POST /api/me/logto-enterprises/:id/stripe-customer-portal`: provisional. An enterprise account is assumed to be the admin tenant that holds the shared subscription, and only an admin of that tenant may open its portal. Revisit when the PM answers the enterprise questions.

## Not needed

- `/me/console-sso/checkout-session`: console SSO is available on the Pro plan only, with no free tier. It is not sold as a separate add-on, so no separate checkout is needed.

## Open questions

- Enterprise accounts: one or many per user, who adds users, who pays. The current enterprise portal assumes an admin-tenant model until these are answered.
