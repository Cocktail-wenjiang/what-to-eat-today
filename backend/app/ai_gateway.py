"""LangChain-compatible boundary; rule matching remains the offline fallback."""


class ModelGateway:
    def __init__(self, enabled: bool = False):
        self.enabled = enabled

    def normalize_request(self, text: str) -> dict:
        if not text.strip():
            raise ValueError("需求文本不能为空")
        return {"text": text.strip(), "provider": "fallback"}
