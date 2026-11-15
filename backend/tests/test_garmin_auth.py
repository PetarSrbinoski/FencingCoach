"""Authentication failures must recover or stop before replacing metrics."""
from datetime import date
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import Mock, patch

from app.services.garmin import GarminService
from garminconnect import GarminConnectAuthenticationError


class GarminAuthTests(TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        patcher = patch("app.services.garmin.settings.GARMIN_TOKEN_DIR", self.directory.name)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.service = GarminService(email="test@example.invalid", password="test")
        self.stale = Mock()
        self.stale.get_stats.side_effect = GarminConnectAuthenticationError(
            "Authentication failed: API Error 401"
        )
        self.stale.get_activities.return_value = []
        self.service._client = self.stale

    def test_stale_cached_session_recovers_using_token_store(self):
        fresh = Mock()
        fresh.get_stats.return_value = {"totalSteps": 123}
        with patch("app.services.garmin.Garmin", return_value=fresh):
            raw = self.service.fetch_day(date(2026, 10, 19))
        self.assertEqual(raw["fetch_failures"], [])
        self.assertEqual(raw["stats"], {"totalSteps": 123})
        fresh.login.assert_called_once_with(self.directory.name)
        fresh.get_sleep_data.assert_called_once_with("2026-10-19")
        self.stale.get_sleep_data.assert_not_called()

    def test_rejected_recovery_aborts_without_persisting_missing_metrics(self):
        fresh = Mock()
        fresh.get_stats.side_effect = GarminConnectAuthenticationError(
            "Authentication failed: API Error 401"
        )
        with (
            patch("app.services.garmin.Garmin", return_value=fresh) as factory,
            patch.object(self.service, "persist_day") as persist,
        ):
            with self.assertRaises(GarminConnectAuthenticationError):
                self.service.sync_recent(Mock(), days=1)
        persist.assert_not_called()
        self.assertLessEqual(factory.call_count, 1)
        self.assertIsNone(self.service._client)

    def test_activity_session_recovers_once(self):
        self.stale.get_activities.side_effect = GarminConnectAuthenticationError(
            "Authentication failed: API Error 401"
        )
        fresh = Mock()
        fresh.get_activities.return_value = [{"activityId": 123}]
        with patch("app.services.garmin.Garmin", return_value=fresh):
            self.assertEqual(self.service.fetch_recent_activities(), [{"activityId": 123}])
        fresh.get_activities.assert_called_once_with(0, 20)

    def test_non_auth_endpoint_failure_remains_partial_without_login(self):
        self.stale.get_stats.side_effect = RuntimeError("Endpoint unavailable")
        with patch("app.services.garmin.Garmin") as factory:
            raw = self.service.fetch_day(date(2026, 10, 19))
        self.assertEqual(raw["fetch_failures"], ["stats"])
        factory.assert_not_called()

    def test_initial_login_failure_aborts_without_persisting_metrics(self):
        self.service._client = None
        fresh = Mock()
        fresh.login.side_effect = RuntimeError("Login unavailable")
        with (
            patch("app.services.garmin.Garmin", return_value=fresh),
            patch.object(self.service, "persist_day") as persist,
        ):
            with self.assertRaisesRegex(RuntimeError, "Login unavailable"):
                self.service.sync_recent(Mock(), days=1)
        persist.assert_not_called()

    def test_activity_auth_failure_is_not_swallowed_as_empty_success(self):
        self.stale.get_activities.side_effect = GarminConnectAuthenticationError(
            "Authentication failed: API Error 401"
        )
        fresh = Mock()
        fresh.get_activities.side_effect = GarminConnectAuthenticationError(
            "Authentication failed: API Error 401"
        )
        with patch("app.services.garmin.Garmin", return_value=fresh):
            with self.assertRaises(GarminConnectAuthenticationError):
                self.service.fetch_recent_activities()


if __name__ == "__main__":
    main()
