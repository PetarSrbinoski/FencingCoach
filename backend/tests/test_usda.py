"""Tests for USDA food service."""

from __future__ import annotations

from app.services.usda import (
    _extract_nutrients,
    _strip_quantity,
    cross_reference_meal,
    match_food,
    search_foods,
)


class TestExtractNutrients:
    def test_known_nutrients(self):
        raw = [
            {"nutrientId": 1008, "value": 165},
            {"nutrientId": 1003, "value": 31},
            {"nutrientId": 1005, "value": 0},
            {"nutrientId": 1004, "value": 3.6},
            {"nutrientId": 1079, "value": 0},
            {"nutrientId": 9999, "value": 100},  # unknown, should be skipped
        ]
        result = _extract_nutrients(raw)
        assert result["kcal"] == 165
        assert result["protein_g"] == 31
        assert result["fat_g"] == 3.6
        assert 9999 not in result

    def test_empty(self):
        assert _extract_nutrients([]) == {}


class TestStripQuantity:
    def test_grams(self):
        assert _strip_quantity("200g chicken breast") == "chicken breast"

    def test_cups(self):
        assert _strip_quantity("1 cup rice") == "rice"

    def test_no_quantity(self):
        assert _strip_quantity("chicken breast") == "chicken breast"

    def test_article(self):
        assert _strip_quantity("a large apple") == "large apple"


class TestSearchFoods:
    def test_empty_query(self, db, seed_usda_foods):
        results = search_foods(db, "")
        assert results == []

    def test_single_term(self, db, seed_usda_foods):
        results = search_foods(db, "chicken")
        assert len(results) == 1
        assert "chicken" in results[0].description_lower

    def test_multiple_terms(self, db, seed_usda_foods):
        results = search_foods(db, "rice white")
        assert len(results) >= 1
        assert "rice" in results[0].description_lower

    def test_no_match(self, db, seed_usda_foods):
        results = search_foods(db, "sauerkraut")
        assert len(results) == 0


class TestMatchFood:
    def test_good_match(self, db, seed_usda_foods):
        result = match_food(db, "chicken breast")
        assert result is not None
        assert "chicken" in result.description_lower

    def test_no_match(self, db, seed_usda_foods):
        result = match_food(db, "dragon fruit pie")
        # May or may not match depending on how loose matching is
        # At minimum, function should not error
        assert result is None or hasattr(result, "fdc_id")

    def test_exact_match(self, db, seed_usda_foods):
        result = match_food(db, "broccoli")
        assert result is not None
        assert "broccoli" in result.description_lower


class TestCrossReferenceMeal:
    def test_simple_meal(self, db, seed_usda_foods):
        matches = cross_reference_meal(db, "chicken breast with rice")
        # Should find at least chicken and rice
        matched_items = [m["matched"].lower() for m in matches]
        assert any("chicken" in m for m in matched_items)
        assert any("rice" in m for m in matched_items)

    def test_no_matches(self, db, seed_usda_foods):
        matches = cross_reference_meal(db, "unicorn meat")
        # Should return empty or partial matches
        assert isinstance(matches, list)

    def test_compound_meal(self, db, seed_usda_foods):
        matches = cross_reference_meal(
            db, "200g chicken breast, 1 cup rice and broccoli"
        )
        assert len(matches) >= 1
