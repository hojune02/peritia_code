def average(values):
    """Return None for an empty input; otherwise calculate the arithmetic mean."""
    if not values:
        return None
    return sum(values) / len(values)
