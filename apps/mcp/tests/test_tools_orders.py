# tests/test_tools_orders.py
#
# The read side only. cancel_order is Task 8, because it cannot be written
# correctly until approval tokens exist.

import httpx
import pytest
import respx

from clients.ecommerce_api import ApiError, EcommerceApi
from tools import orders

BASE = "https://api.test"


def api() -> EcommerceApi:
    return EcommerceApi(base_url=BASE, token="tok")


def order(**overrides):
    base = {
        "id": "o1",
        "orderNumber": "ORD-1",
        "status": "PENDING",
        "total": "59.98",
        "orderItems": [],
    }
    base.update(overrides)
    return base


@respx.mock
async def test_get_orders_never_sends_a_user_id():
    # /api/v1/orders scopes to the user its own session helper verified.
    # A user_id argument here would be an LLM-supplied identity, which is
    # the one thing §1.4 forbids.
    route = respx.get(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(200, json={"data": {"orders": []}})
    )

    await orders.get_orders(api(), limit=5)

    params = route.calls.last.request.url.params
    assert params["limit"] == "5"
    assert "userId" not in params
    assert "user_id" not in params
    assert "email" not in params


@respx.mock
async def test_get_orders_models_each_order():
    respx.get(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "orders": [
                        order(
                            orderItems=[
                                {
                                    "productId": "p1",
                                    "productName": "Runner",
                                    "quantity": 2,
                                    "price": "29.99",
                                }
                            ]
                        )
                    ]
                }
            },
        )
    )

    result = await orders.get_orders(api())

    assert result[0].order_number == "ORD-1"
    assert result[0].items[0].product_name == "Runner"


@respx.mock
async def test_no_orders_is_an_empty_list_not_an_error():
    respx.get(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(200, json={"data": {"orders": []}})
    )

    assert await orders.get_orders(api()) == []


@respx.mock
async def test_get_orders_omits_an_unspecified_limit():
    route = respx.get(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(200, json={"data": {"orders": []}})
    )

    await orders.get_orders(api())

    assert "limit" not in route.calls.last.request.url.params


@respx.mock
async def test_get_order_returns_one_order():
    respx.get(f"{BASE}/api/v1/orders/o1").mock(
        return_value=httpx.Response(200, json={"data": order(status="DELIVERED")})
    )

    found = await orders.get_order(api(), order_id="o1")

    assert found.id == "o1"
    assert found.status == "DELIVERED"


@respx.mock
async def test_someone_elses_order_is_indistinguishable_from_a_missing_one():
    respx.get(f"{BASE}/api/v1/orders/o9").mock(
        return_value=httpx.Response(404, json={"error": "Order not found"})
    )

    with pytest.raises(ApiError) as caught:
        await orders.get_order(api(), order_id="o9")

    # 404, not 403 -- and this layer must not "helpfully" turn it into one,
    # because a 403 confirms the id is real, which is all an enumeration
    # attack needs.
    assert caught.value.status == 404
    assert caught.value.message == "Order not found"


@respx.mock
async def test_an_unauthenticated_read_surfaces_as_401():
    respx.get(f"{BASE}/api/v1/orders").mock(
        return_value=httpx.Response(401, json={"error": "Authentication required"})
    )

    with pytest.raises(ApiError) as caught:
        await orders.get_orders(EcommerceApi(base_url=BASE))

    assert caught.value.status == 401
