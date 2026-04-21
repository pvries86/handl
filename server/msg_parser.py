import json
import sys
from datetime import datetime

from bs4 import BeautifulSoup
from extract_msg import Message


def normalize_text(value):
    if not value:
        return ""
    return "\n\n".join(part.strip() for part in str(value).replace("\r\n", "\n").split("\n\n") if part.strip())


def html_to_text(value):
    if not value:
        return ""
    if isinstance(value, bytes):
      decoded = value.decode("utf-8", errors="ignore")
    else:
      decoded = str(value)
    return normalize_text(BeautifulSoup(decoded, "html.parser").get_text("\n"))


def format_date(msg):
    parsed = getattr(msg, "parsedDate", None)
    if isinstance(parsed, datetime):
        return parsed.isoformat()

    date_str = getattr(msg, "date", None)
    if date_str:
        return str(date_str)

    received = getattr(msg, "receivedTime", None)
    if isinstance(received, datetime):
        return received.isoformat()

    return None


def parse_msg(path):
    msg = Message(path)
    try:
        body = normalize_text(getattr(msg, "body", None))
        if not body:
            body = html_to_text(getattr(msg, "htmlBody", None))

        payload = {
            "subject": getattr(msg, "subject", None),
            "from": getattr(msg, "sender", None),
            "sentAt": format_date(msg),
            "body": body,
        }
        print(json.dumps(payload))
    finally:
        msg.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: msg_parser.py <path>"}))
        sys.exit(1)
    parse_msg(sys.argv[1])
