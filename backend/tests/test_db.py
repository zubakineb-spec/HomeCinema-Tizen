import tempfile
import unittest
from pathlib import Path

from app.db import Database


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Database(Path(self.tmp.name) / "catalog.db")

    def tearDown(self):
        self.tmp.cleanup()

    def test_show_seasons_are_grouped(self):
        show_id = self.db.upsert_show("Fallout")
        self.db.upsert_episode(show_id, "http://media/Fallout.S01E01.mkv", 1, 1, "Серия 1")
        self.db.upsert_episode(show_id, "http://media/Fallout.S02E01.mkv", 2, 1, "Серия 1")
        show = self.db.show_by_id(show_id)
        self.assertEqual([x["number"] for x in show["seasons"]], [1, 2])
        self.assertEqual(show["seasons"][0]["episode_count"], 1)

    def test_search_movies_and_shows(self):
        self.db.upsert_movie("http://media/Interstellar.mkv", "Интерстеллар", 2014)
        self.db.upsert_show("Интерны")
        result = self.db.search("Интер")
        self.assertEqual(len(result["movies"]), 1)
        self.assertEqual(len(result["shows"]), 1)

    def test_continue_watching_contains_movie_and_episode(self):
        movie_url = "http://media/Movie.mkv"
        episode_url = "http://media/Show.S01E01.mkv"
        self.db.upsert_movie(movie_url, "Movie", 2026)
        show_id = self.db.upsert_show("Show")
        self.db.upsert_episode(show_id, episode_url, 1, 1, "Pilot")
        self.db.set_progress(movie_url, 1000, 10000, False)
        self.db.set_progress(episode_url, 5000, 10000, False)
        items = self.db.continue_watching()
        self.assertEqual({x["media_type"] for x in items}, {"movie", "episode"})
        self.assertEqual({x["progress_percent"] for x in items}, {10.0, 50.0})


if __name__ == "__main__":
    unittest.main()
