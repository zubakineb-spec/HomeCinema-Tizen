import unittest
from app.parser import parse_media_url

BASE = "http://192.168.0.101/"


class ParserTests(unittest.TestCase):
    def test_movie(self):
        x = parse_media_url(BASE + "Films/Interstellar.2014.2160p.HDR.mkv", BASE)
        self.assertEqual(x.kind, "movie")
        self.assertEqual(x.title, "Interstellar")
        self.assertEqual(x.year, 2014)

    def test_sxxexx(self):
        x = parse_media_url(BASE + "Series/Fallout/Season%2001/Fallout.S01E02.2160p.mkv", BASE)
        self.assertEqual((x.kind, x.show_title, x.season, x.episode), ("episode", "Fallout", 1, 2))

    def test_russian_folder_numeric_episode(self):
        x = parse_media_url(BASE + "%D0%A1%D0%B5%D1%80%D0%B8%D0%B0%D0%BB%D1%8B/Game%20of%20Thrones/%D0%A1%D0%B5%D0%B7%D0%BE%D0%BD%2002/03.mkv", BASE)
        self.assertEqual((x.kind, x.show_title, x.season, x.episode), ("episode", "Game of Thrones", 2, 3))

    def test_1x03(self):
        x = parse_media_url(BASE + "Series/Sherlock/Sherlock.1x03.mkv", BASE)
        self.assertEqual((x.kind, x.show_title, x.season, x.episode), ("episode", "Sherlock", 1, 3))

    def test_numeric_episode_with_title_in_season_folder(self):
        x = parse_media_url(BASE + "Series/Fallout/Сезон%2001/01%20-%20Пилот.mkv", BASE)
        self.assertEqual((x.kind, x.show_title, x.season, x.episode), ("episode", "Fallout", 1, 1))


if __name__ == "__main__":
    unittest.main()
