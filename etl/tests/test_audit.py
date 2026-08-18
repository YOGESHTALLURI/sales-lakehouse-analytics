"""Error sanitisation for the audit trail.

`pipeline_runs.error_summary` is served to the browser by
`GET /api/pipeline/status`, so anything that reaches it is public. These specs
need no services, which is why they live in the default suite rather than behind
the integration flag: a leak must fail the fast checks.
"""

from __future__ import annotations

import pytest

from etl.audit import MAX_SUMMARY_LENGTH, sanitise_error


class TestCredentialRedaction:
    @pytest.mark.parametrize(
        "secret,message",
        [
            (
                "local_dev_password",
                "could not connect to postgresql://sales_app:local_dev_password@postgres:5432/db",
            ),
            (
                "AKIAIOSFODNN7EXAMPLE",
                "signature failed with secret_access_key=AKIAIOSFODNN7EXAMPLE",
            ),
            (
                "wJalrXUtnFEMI",
                "boto3 rejected aws_secret_access_key=wJalrXUtnFEMI on upload",
            ),
            (
                "s3cr3t-value",
                "MINIO_ROOT_PASSWORD=s3cr3t-value was refused",
            ),
            (
                "ghp_abcdefghijklmnop",
                "auth failed: api_key: ghp_abcdefghijklmnop",
            ),
            (
                "tok-12345",
                "session invalid, token=tok-12345",
            ),
        ],
    )
    def test_redacts_the_secret(self, secret: str, message: str) -> None:
        summary = sanitise_error(RuntimeError(message))

        assert secret not in summary, summary
        assert "[redacted]" in summary

    def test_redacts_an_underscore_prefixed_key_name(self) -> None:
        # The regression this guards: a `\b`-anchored pattern never matches
        # `secret_access_key=`, because the underscore before `access` is a word
        # character. That gap leaked an AWS secret key.
        summary = sanitise_error(RuntimeError("secret_access_key=AKIAIOSFODNN7EXAMPLE"))

        assert "AKIAIOSFODNN7EXAMPLE" not in summary

    def test_redacts_a_bare_aws_key_id_with_no_surrounding_name(self) -> None:
        summary = sanitise_error(RuntimeError("request signed by AKIAIOSFODNN7EXAMPLE was denied"))

        assert "AKIAIOSFODNN7EXAMPLE" not in summary


class TestDiagnosticValue:
    def test_keeps_the_exception_type(self) -> None:
        assert sanitise_error(ValueError("bad input")).startswith("ValueError:")

    def test_preserves_a_message_that_holds_no_secret(self) -> None:
        summary = sanitise_error(RuntimeError("NoSuchBucket: sales-lake is missing"))

        assert "NoSuchBucket" in summary
        assert "sales-lake is missing" in summary
        assert "[redacted]" not in summary

    def test_does_not_redact_a_useful_constraint_diagnostic(self) -> None:
        # `Duplicate key: …` must survive. Redacting on a bare `key` would have
        # destroyed the most informative part of a constraint violation.
        summary = sanitise_error(
            RuntimeError('Constraint Error: Duplicate key "order_item_id: f0000000-0000"')
        )

        assert "order_item_id" in summary
        assert "[redacted]" not in summary

    def test_collapses_newlines_so_the_summary_stays_one_line(self) -> None:
        summary = sanitise_error(RuntimeError("first line\nsecond line"))

        assert "\n" not in summary
        assert "second line" in summary

    def test_truncates_a_very_long_message(self) -> None:
        summary = sanitise_error(RuntimeError("x" * 5_000))

        # A driver can produce a multi-kilobyte message; the column is displayed
        # in a browser, not archived.
        assert len(summary) <= MAX_SUMMARY_LENGTH
        assert summary.endswith("…")
