# tests/test_tools_cart.py
#
# get_cart only. The mutations are Task 7.

import httpx
import pytest
import respx

from clients.ecommerce_api import ApiError, EcommerceApi
from tools import cart

BASE = "https://api.test"


def api() -> EcommerceApi:
    return EcommerceApi(base_url=BASE, token="tok")


def cart_body(**overrides):
    base = {
        "items": [
            {
                "id": "ci1",
                "quantity": 2,
                "productId": "p1",
                "product": {
                    "id": "p1",
                    "name": "Runner",
                    "slug": "runner",
                    "price": "29.99",
                },
            }
        ],
        "itemCount": 2,
        "subtotal": "59.98",
    }
    base.update(overrides)
    return base


@respx.mock
async def test_get_cart_returns_the_computed_totals():
    respx.get(f"{BASE}/api/v1/cart").mock(
        return_value=httpx.Response(200, json={"data": cart_body()})
    )

    view = await cart.get_cart(api())

    # Totals come from the API so an agent never does money arithmetic.
    assert view.subtotal == "59.98"
    assert view.item_count == 2
    assert view.items[0].product.name == "Runner"


@respx.mock
async def test_an_empty_cart_is_not_an_error():
    respx.get(f"{BASE}/api/v1/cart").mock(
        return_value=httpx.Response(
            200, json={"data": {"items": [], "itemCount": 0, "subtotal": "0.00"}}
        )
    )

    view = await cart.get_cart(api())

    assert view.item_count == 0
    assert view.items == []


@respx.mock
async def test_get_cart_never_names_a_cart():
    # The API returns the cart belonging to the token's user. Naming one
    # would be asking for someone else's.
    route = respx.get(f"{BASE}/api/v1/cart").mock(
        return_value=httpx.Response(200, json={"data": cart_body()})
    )

    await cart.get_cart(api())

    assert str(route.calls.last.request.url).endswith("/api/v1/cart")


@respx.mock
async def test_an_unauthenticated_cart_read_surfaces_as_401():
    respx.get(f"{BASE}/api/v1/cart").mock(
        return_value=httpx.Response(401, json={"error": "Authentication required"})
    )

    with pytest.raises(ApiError) as caught:
        await cart.get_cart(EcommerceApi(base_url=BASE))

    assert caught.value.status == 401
