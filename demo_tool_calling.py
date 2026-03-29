import os
import json
from dotenv import load_dotenv
import anthropic

load_dotenv()

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# ─────────────────────────────────────────────
# 1. OBICAN POZIV - bez tool use
# ─────────────────────────────────────────────
print("=" * 60)
print("1. OBICAN POZIV (bez tool use)")
print("=" * 60)

response = client.messages.create(
    model="claude-haiku-4-5-20251001",
    max_tokens=256,
    messages=[
        {"role": "user", "content": "Koja je temperatura u Zagrebu danas?"}
    ]
)

print("\n--- RAW RESPONSE ---")
print(f"stop_reason : {response.stop_reason}")
print(f"content     : {response.content}")
print(f"\nTEKST ODGOVOR: {response.content[0].text}")


# ─────────────────────────────────────────────
# 2. POZIV S TOOL USE
# ─────────────────────────────────────────────
print("\n" + "=" * 60)
print("2. POZIV S TOOL USE")
print("=" * 60)

tools = [
    {
        "name": "get_weather",
        "description": "Dohvati trenutnu temperaturu za grad.",
        "input_schema": {
            "type": "object",
            "properties": {
                "city": {
                    "type": "string",
                    "description": "Naziv grada"
                }
            },
            "required": ["city"]
        }
    }
]

response_with_tool = client.messages.create(
    model="claude-haiku-4-5-20251001",
    max_tokens=256,
    tools=tools,
    messages=[
        {"role": "user", "content": "Koja je temperatura u Zagrebu danas?"}
    ]
)

print("\n--- RAW RESPONSE ---")
print(f"stop_reason : {response_with_tool.stop_reason}")
print(f"content     : {response_with_tool.content}")

tool_use_block = response_with_tool.content[0]
print(f"\nTool name   : {tool_use_block.name}")
print(f"Tool id     : {tool_use_block.id}")
print(f"Tool input  : {tool_use_block.input}")


# ─────────────────────────────────────────────
# 3. IZVRSAVAMO TOOL (fake) I VRACAMO REZULTAT
# ─────────────────────────────────────────────
print("\n" + "=" * 60)
print("3. IZVRSAVAMO TOOL I NASTAVLJAMO KONVERZACIJU")
print("=" * 60)

# Simuliramo poziv pravog API-ja - vracamo lazni rezultat
fake_weather_result = {"temperature": 18, "unit": "celsius", "condition": "oblacno"}

print(f"\n[ORCHESTRATOR] Pozivam tool '{tool_use_block.name}' s argumentima: {tool_use_block.input}")
print(f"[ORCHESTRATOR] Tool vratio: {fake_weather_result}")
print(f"[ORCHESTRATOR] Saljem rezultat nazad modelu...\n")

final_response = client.messages.create(
    model="claude-haiku-4-5-20251001",
    max_tokens=256,
    tools=tools,
    messages=[
        # originalna poruka
        {"role": "user", "content": "Koja je temperatura u Zagrebu danas?"},
        # model je trazio tool
        {"role": "assistant", "content": response_with_tool.content},
        # mi vracamo rezultat toola
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tool_use_block.id,   # mora matchati id iz gore
                    "content": json.dumps(fake_weather_result)
                }
            ]
        }
    ]
)

print(f"stop_reason     : {final_response.stop_reason}")
print(f"FINALNI ODGOVOR : {final_response.content[0].text}")
