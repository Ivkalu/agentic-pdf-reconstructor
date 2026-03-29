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

fake_weather_result = {"temperature": 18, "unit": "celsius", "condition": "oblacno"}

print(f"\n[ORCHESTRATOR] Pozivam tool '{tool_use_block.name}' s argumentima: {tool_use_block.input}")
print(f"[ORCHESTRATOR] Tool vratio: {fake_weather_result}")
print(f"[ORCHESTRATOR] Saljem rezultat nazad modelu...\n")

final_response = client.messages.create(
    model="claude-haiku-4-5-20251001",
    max_tokens=256,
    tools=tools,
    messages=[
        {"role": "user", "content": "Koja je temperatura u Zagrebu danas?"},
        {"role": "assistant", "content": response_with_tool.content},
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tool_use_block.id,
                    "content": json.dumps(fake_weather_result)
                }
            ]
        }
    ]
)

print(f"stop_reason     : {final_response.stop_reason}")
print(f"FINALNI ODGOVOR : {final_response.content[0].text}")


# ─────────────────────────────────────────────
# 4. EXTENDED THINKING
# Napomena: zahtijeva claude-3-7-sonnet ili noviji model
# budget_tokens = koliko tokena model smije potrositi na razmisljanje
# ─────────────────────────────────────────────
print("\n" + "=" * 60)
print("4. EXTENDED THINKING")
print("=" * 60)

thinking_response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=16000,          # mora biti veci od budget_tokens
    thinking={
        "type": "enabled",
        "budget_tokens": 10000  # max tokena za thinking
    },
    messages=[
        {"role": "user", "content": "Koja je temperatura u Zagrebu danas?"}
    ]
)

print("\n--- RAW CONTENT BLOCKS ---")
for i, block in enumerate(thinking_response.content):
    print(f"\n[block {i}] type = {block.type}")
    if block.type == "thinking":
        # thinking block - interni reasoning, enkriptiran/neopaque u produkciji
        print(f"  thinking (prvih 300 znakova):\n  {block.thinking[:300]}...")
    elif block.type == "text":
        print(f"  text: {block.text}")

print(f"\nstop_reason : {thinking_response.stop_reason}")


# ─────────────────────────────────────────────
# 5. THINKING + TOOL USE ZAJEDNO
# Model razmislja, pa odluci pozvati tool
# ─────────────────────────────────────────────
print("\n" + "=" * 60)
print("5. THINKING + TOOL USE ZAJEDNO")
print("=" * 60)

thinking_tool_response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=16000,
    thinking={
        "type": "enabled",
        "budget_tokens": 5000
    },
    tools=tools,
    messages=[
        {"role": "user", "content": "Trebam znati temperaturu u Zagrebu da odlucim sto obuci."}
    ]
)

print("\n--- RAW CONTENT BLOCKS ---")
for i, block in enumerate(thinking_tool_response.content):
    print(f"\n[block {i}] type = {block.type}")
    if block.type == "thinking":
        print(f"  thinking (prvih 200 znakova):\n  {block.thinking[:200]}...")
    elif block.type == "tool_use":
        print(f"  tool_use:")
        print(f"    name  : {block.name}")
        print(f"    id    : {block.id}")
        print(f"    input : {block.input}")
    elif block.type == "text":
        print(f"  text: {block.text}")

print(f"\nstop_reason : {thinking_tool_response.stop_reason}")
print("\nRedoslijed blokova pokazuje: model PRVO razmislja, ZATIM trazi tool")
