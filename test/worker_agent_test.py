import unittest
from unittest.mock import Mock, patch

import worker_agent


class ResearchToolTests(unittest.TestCase):
    def test_beautifulsoup_extracts_content_metadata_links_and_tables(self):
        parsed = worker_agent.extract_beautifulsoup(
            '<title>Example</title><script>ignore()</script><h1>Facts</h1>'
            '<p>The useful source text is retained for Ella research.</p>'
            '<a href="/docs">Docs</a><table><tr><th>Key</th></tr><tr><td>Value</td></tr></table>',
            "https://example.test/page",
        )
        self.assertEqual(parsed["title"], "Example")
        self.assertIn("useful source text", parsed["text"])
        self.assertNotIn("ignore", parsed["text"])
        self.assertEqual(parsed["links"], ["https://example.test/docs"])
        self.assertEqual(parsed["tables"], [[["Key"], ["Value"]]])

    def test_http_result_falls_back_to_selenium_for_sparse_content(self):
        http_page = {"url": "https://example.test", "title": "Example", "text": "JS shell", "claims": [], "links": [], "tables": [], "method": "HTTP/BeautifulSoup"}
        selenium_page = {**http_page, "text": "Rendered content", "method": "Selenium"}
        with patch.object(worker_agent, "fetch_page_http", return_value=http_page), patch.object(worker_agent, "fetch_page_selenium", return_value=selenium_page):
            result = worker_agent.fetch_page("https://example.test")
        self.assertEqual(result["method"], "Selenium")
        self.assertEqual(result["text"], "Rendered content")

    def test_pyautogui_screenshot_action_is_explicit_and_reported(self):
        fake = Mock()
        with patch.object(worker_agent, "pyautogui", fake):
            result = worker_agent.run_pyautogui_action({"operation": "screenshot", "path": "worker-test.png"})
        fake.screenshot.assert_called_once()
        self.assertEqual(result["operation"], "screenshot")


if __name__ == "__main__":
    unittest.main()
