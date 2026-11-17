def gist(text, n):
    s = str(text or "")
    if len(s) <= n:
        return s
    head = (n - 5) * 2 // 3
    return s[:head].rstrip() + " ... " + s[len(s) - (n - 5 - head):].lstrip()
