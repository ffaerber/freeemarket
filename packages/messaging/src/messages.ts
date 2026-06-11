/**
 * Typed message payloads + lightweight runtime validators.
 *
 * Two payload kinds travel over the same machinery (see CLAUDE.md §5):
 *   - `ShippingAddress`  — buyer → seller, after `buy()` funds escrow.
 *   - `ShipmentUpdate`   — seller → buyer, after the seller ships (tracking code).
 *
 * Validators are hand-rolled type guards (no ajv) ON PURPOSE: these payloads are
 * tiny and have no `$ref` reuse, so a heavy JSON-Schema dependency would not pay
 * for itself here. (`@freeemarket/schema` uses ajv because its objects are larger
 * and cross-referenced.) The guards follow the same `is*` / `assert*` shape as
 * `@freeemarket/schema` so consumers get a consistent API across packages.
 */

/** Buyer → seller: the private shipping address for an order. */
export interface ShippingAddress {
  orderId: string;
  name: string;
  address: string;
}

/** Seller → buyer: a shipment update / tracking code for an order. */
export interface ShipmentUpdate {
  orderId: string;
  carrier?: string;
  trackingCode?: string;
  note?: string;
}

/** Error thrown by the `assert*` validators. */
export class MessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageValidationError';
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isOptionalString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === 'string';
}

export function isShippingAddress(value: unknown): value is ShippingAddress {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isNonEmptyString(v.orderId) &&
    isNonEmptyString(v.name) &&
    isNonEmptyString(v.address)
  );
}

export function assertShippingAddress(value: unknown): ShippingAddress {
  if (!isShippingAddress(value)) {
    throw new MessageValidationError(
      'Invalid ShippingAddress: expected { orderId, name, address } as non-empty strings',
    );
  }
  return value;
}

export function isShipmentUpdate(value: unknown): value is ShipmentUpdate {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.orderId)) return false;
  if (!isOptionalString(v.carrier)) return false;
  if (!isOptionalString(v.trackingCode)) return false;
  if (!isOptionalString(v.note)) return false;
  // A shipment update must carry SOMETHING actionable beyond the orderId.
  return (
    isNonEmptyString(v.trackingCode) ||
    isNonEmptyString(v.carrier) ||
    isNonEmptyString(v.note)
  );
}

export function assertShipmentUpdate(value: unknown): ShipmentUpdate {
  if (!isShipmentUpdate(value)) {
    throw new MessageValidationError(
      'Invalid ShipmentUpdate: expected { orderId, …(carrier|trackingCode|note) } with at least one update field',
    );
  }
  return value;
}
