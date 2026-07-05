"""Fragments shared by more than one prompt."""

# Reasoning-model control prefix. Prepended when using models like
# Nemotron Ultra/Super that have a thinking mode. Harmless for standard
# instruct models (e.g. meta/llama-3.3-70b-instruct).
THINKING_OFF = "detailed thinking off\n\n"
