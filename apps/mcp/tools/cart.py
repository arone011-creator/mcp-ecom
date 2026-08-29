"""Cart capabilities. Phase 3 hands this file to the Cart agent.

Always the cart belonging to the token's user, never one named in the
request. The API enforces that; this file simply never offers a way to ask
for another.
"""

from clients.ecommerce_api import EcommerceApi
from models.schemas import CartView


async def get_cart(api: EcommerceApi) -> CartView:
    """The caller's cart, with item count and subtotal already computed.

    The totals come from the API on purpose, so no agent ever does money
    arithmetic on values it may have rounded on the way in.
    """
    return CartView.model_validate(await api.get("/api/v1/cart"))
