from __future__ import annotations

from typing import Iterable, Sequence, TypeVar


T = TypeVar("T")


def choose_one(title: str, options: Sequence[T], render: callable | None = None) -> T:
    if not options:
        raise SystemExit(f"no options available for {title}")
    render = render or (lambda item: str(item))
    print(title)
    for index, item in enumerate(options, start=1):
        print(f"  {index}. {render(item)}")
    while True:
        raw = input("> ").strip()
        if raw == "" and len(options) == 1:
            return options[0]
        try:
            value = int(raw)
        except ValueError:
            print("Enter a number from the list.")
            continue
        if 1 <= value <= len(options):
            return options[value - 1]
        print("Selection out of range.")


def choose_many(title: str, options: Sequence[T], render: callable | None = None) -> list[T]:
    if not options:
        return []
    render = render or (lambda item: str(item))
    print(title)
    for index, item in enumerate(options, start=1):
        print(f"  {index}. {render(item)}")
    print("Enter comma-separated numbers, or press Enter to select all.")
    while True:
        raw = input("> ").strip()
        if raw == "":
            return list(options)
        values: list[T] = []
        valid = True
        for chunk in raw.split(","):
            chunk = chunk.strip()
            try:
                index = int(chunk)
            except ValueError:
                valid = False
                break
            if index < 1 or index > len(options):
                valid = False
                break
            values.append(options[index - 1])
        if valid:
            deduped: list[T] = []
            for item in values:
                if item not in deduped:
                    deduped.append(item)
            return deduped
        print("Enter valid numbers from the list.")


def prompt_value(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    raw = input(f"{prompt}{suffix}: ").strip()
    return raw or default


def prompt_bool(prompt: str, default: bool = False) -> bool:
    default_text = "Y/n" if default else "y/N"
    while True:
        raw = input(f"{prompt} [{default_text}]: ").strip().lower()
        if raw == "":
            return default
        if raw in {"y", "yes"}:
            return True
        if raw in {"n", "no"}:
            return False
        print("Enter y or n.")
