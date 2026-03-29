import os
import json
from dotenv import load_dotenv
import anthropic

load_dotenv()

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

tools = [
    {
        "name": "get_weather",
        "description": "Dohvati trenutnu temperaturu za grad.",
        "input_schema": {
            "type": "object",
            "properties": {
                "city": {"type": "string"}
            },
            "required": ["city"]
        }
    }
]

# ─────────────────────────────────────────────
# 1. OBICAN POZIV
# ─────────────────────────────────────────────
print("=" * 60)
print("1. OBICAN POZIV")
print("=" * 60)

request_1 = {
    "model": "claude-haiku-4-5-20251001",
    "max_tokens": 256,
    "messages": [
        {"role": "user", "content": "Koja je temperatura u Zagrebu danas?"}
    ]
}

print("\n>>> REQUEST:")
print(json.dumps(request_1, indent=2, ensure_ascii=False))

r1 = client.messages.create(**request_1)

print("\n<<< RESPONSE:")
print(json.dumps(r1.model_dump(), indent=2, ensure_ascii=False))


# ─────────────────────────────────────────────
# 2. POZIV S TOOL USE
# ─────────────────────────────────────────────
print("\n" + "=" * 60)
print("2. POZIV S TOOL USE")
print("=" * 60)

request_2 = {
    "model": "claude-haiku-4-5-20251001",
    "max_tokens": 256,
    "tools": tools,
    "messages": [
        {"role": "user", "content": "Koja je temperatura u Zagrebu danas?"}
    ]
}

print("\n>>> REQUEST:")
print(json.dumps(request_2, indent=2, ensure_ascii=False))

r2 = client.messages.create(**request_2)

print("\n<<< RESPONSE:")
print(json.dumps(r2.model_dump(), indent=2, ensure_ascii=False))


# ─────────────────────────────────────────────
# 3. VRACAMO TOOL RESULT
# ─────────────────────────────────────────────
print("\n" + "=" * 60)
print("3. VRACAMO TOOL RESULT")
print("=" * 60)

tool_block = r2.model_dump()["content"][0]
fake_result = {"temperature": 18, "unit": "celsius", "condition": "oblacno"}

request_3 = {
    "model": "claude-haiku-4-5-20251001",
    "max_tokens": 256,
    "tools": tools,
    "messages": [
        {"role": "user", "content": "Koja je temperatura u Zagrebu danas?"},
        {"role": "assistant", "content": r2.model_dump()["content"]},
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tool_block["id"],
                    "content": json.dumps(fake_result)
                }
            ]
        }
    ]
}

print("\n>>> REQUEST:")
print(json.dumps(request_3, indent=2, ensure_ascii=False))

r3 = client.messages.create(**request_3)

print("\n<<< RESPONSE:")
print(json.dumps(r3.model_dump(), indent=2, ensure_ascii=False))
