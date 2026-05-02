#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

PROMPT = (
    'Extract workflow items from this message - think ToDo items, Reminders, '
    'Deadlines, Progress Updates, Assignments, etc.\n\n'
    'Return concise bullet points. If nothing actionable is found, say: "No workflow items found."'
)


def load_payload() -> dict:
    raw = sys.stdin.read().strip()
    if not raw:
        raise ValueError('No JSON payload received on stdin')
    return json.loads(raw)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--max-new-tokens', type=int, default=220)
    args = parser.parse_args()

    model_dir = Path(args.model_dir)
    if not model_dir.exists():
        print(json.dumps({'ok': False, 'error': f'Model directory not found: {model_dir}'}))
        return 1

    payload = load_payload()
    text = str(payload.get('text', '')).strip()
    if not text:
        print(json.dumps({'ok': False, 'error': 'No message text provided'}))
        return 1

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
        model = AutoModelForCausalLM.from_pretrained(
            model_dir,
            local_files_only=True,
            torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
            device_map='auto' if torch.cuda.is_available() else None,
        )

        full_prompt = f"{PROMPT}\n\nMessage:\n{text}\n\nWorkflow items:"
        inputs = tokenizer(full_prompt, return_tensors='pt')
        if torch.cuda.is_available():
            inputs = {k: v.to(model.device) for k, v in inputs.items()}

        output = model.generate(
            **inputs,
            max_new_tokens=args.max_new_tokens,
            do_sample=False,
            temperature=0.1,
            pad_token_id=tokenizer.eos_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )

        generated = output[0][inputs['input_ids'].shape[-1]:]
        decoded = tokenizer.decode(generated, skip_special_tokens=True).strip()
        if not decoded:
            decoded = 'No workflow items found.'

        print(json.dumps({'ok': True, 'output': decoded}))
        return 0
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
