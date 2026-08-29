"""Order capabilities. Phase 3 hands this file to the Order agent.

Identity is never an argument here. /api/v1/orders filters by the user its
own session helper verified; accepting an id would mean trusting one a
model produced, which is exactly what §1.4 forbids.
"""

from clients.ecommerce_api import EcommerceApi
from models.schemas import OrderSummary


async def get_orders(api: EcommerceApi, limit: int | None = None) -> list[OrderSummary]:
    """The caller's own orders, newest first."""
    data = await api.get("/api/v1/orders", {"limit": limit})
    return [OrderSummary.model_validate(order) for order in data.get("orders", [])]


async def get_order(api: EcommerceApi, order_id: str) -> OrderSummary:
    """One order, if the caller placed it.

    An order belonging to someone else answers 404, identically to one that
    does not exist. That is deliberate on the API's side -- a 403 would
    confirm the id is real -- and it is passed through unchanged rather
    than being translated into something more "helpful".
    """
    return OrderSummary.model_validate(await api.get(f"/api/v1/orders/{order_id}"))
