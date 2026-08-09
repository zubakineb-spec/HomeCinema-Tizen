package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Store struct {
	mu           sync.RWMutex
	catalogPath  string
	progressPath string
	state        State
}

func NewStore(dataDir string) (*Store, error) {
	s := &Store{catalogPath: filepath.Join(dataDir,"catalog.json"), progressPath: filepath.Join(dataDir,"progress.json"), state: State{NextID:1, Progress:map[string]Progress{}}}
	if err := os.MkdirAll(dataDir,0755); err != nil { return nil,err }
	if b,err:=os.ReadFile(s.catalogPath); err==nil { var cat State; if json.Unmarshal(b,&cat)==nil { s.state.NextID=cat.NextID; s.state.Movies=cat.Movies; s.state.Shows=cat.Shows; s.state.Episodes=cat.Episodes } }
	if b,err:=os.ReadFile(s.progressPath); err==nil { _=json.Unmarshal(b,&s.state.Progress) }
	if s.state.NextID<1 { s.state.NextID=1 }; if s.state.Progress==nil { s.state.Progress=map[string]Progress{} }
	return s,nil
}
func atomicJSON(path string,v any) error { b,err:=json.MarshalIndent(v,"","  "); if err!=nil{return err}; tmp:=path+".tmp"; if err=os.WriteFile(tmp,b,0644);err!=nil{return err}; return os.Rename(tmp,path) }
func (s *Store) saveCatalogLocked() error { return atomicJSON(s.catalogPath,State{NextID:s.state.NextID,Movies:s.state.Movies,Shows:s.state.Shows,Episodes:s.state.Episodes}) }
func (s *Store) saveProgressLocked() error { return atomicJSON(s.progressPath,s.state.Progress) }
func (s *Store) nextIDLocked() int { id:=s.state.NextID; s.state.NextID++; return id }
func now() string { return time.Now().UTC().Format(time.RFC3339) }
func (s *Store) ReplaceScan(movies []Movie,shows []Show,episodes []Episode) error {
	s.mu.Lock(); defer s.mu.Unlock()
	oldMovies:=map[string]Movie{}; for _,x:=range s.state.Movies { oldMovies[x.SourceURL]=x }
	oldShows:=map[string]Show{}; for _,x:=range s.state.Shows { oldShows[strings.ToLower(x.Title)]=x }
	oldEps:=map[string]Episode{}; for _,x:=range s.state.Episodes { oldEps[x.SourceURL]=x }
	showIDMap:=map[int]int{}
	for i:=range movies { if old,ok:=oldMovies[movies[i].SourceURL];ok { movies[i].ID=old.ID; movies[i].TMDBID=old.TMDBID; movies[i].RecognizedTitle=old.RecognizedTitle; movies[i].OriginalTitle=old.OriginalTitle; movies[i].Overview=old.Overview; movies[i].PosterURL=old.PosterURL; movies[i].BackdropURL=old.BackdropURL; movies[i].Rating=old.Rating; movies[i].Runtime=old.Runtime; movies[i].Genres=old.Genres; movies[i].MetadataStatus=old.MetadataStatus; movies[i].AddedAt=old.AddedAt } else { movies[i].ID=s.nextIDLocked(); movies[i].AddedAt=now() }; movies[i].UpdatedAt=now(); if movies[i].MetadataStatus=="" { movies[i].MetadataStatus="pending" } }
	for i:=range shows { temp:=shows[i].ID; if old,ok:=oldShows[strings.ToLower(shows[i].Title)];ok { shows[i]=mergeShow(shows[i],old); shows[i].ID=old.ID } else { shows[i].ID=s.nextIDLocked(); shows[i].AddedAt=now(); shows[i].MetadataStatus="pending" }; shows[i].UpdatedAt=now(); showIDMap[temp]=shows[i].ID }
	for i:=range episodes {
		episodes[i].ShowID=showIDMap[episodes[i].ShowID]
		if old,ok:=oldEps[episodes[i].SourceURL];ok {
			episodes[i].ID=old.ID
			episodes[i].AddedAt=old.AddedAt
			if isExtra(episodes[i]) {
				episodes[i].MetadataStatus="local"
			} else {
				episodes[i].Overview=old.Overview
				episodes[i].StillURL=old.StillURL
				episodes[i].Runtime=old.Runtime
				episodes[i].AirDate=old.AirDate
				episodes[i].MetadataStatus=old.MetadataStatus
				if episodes[i].ContentType=="" { episodes[i].ContentType=episodeContentType(old) }
			}
		} else {
			episodes[i].ID=s.nextIDLocked()
			episodes[i].AddedAt=now()
			if isExtra(episodes[i]) { episodes[i].MetadataStatus="local" } else { episodes[i].MetadataStatus="pending" }
		}
		episodes[i].UpdatedAt=now()
	}
	s.state.Movies=movies; s.state.Shows=shows; s.state.Episodes=episodes; return s.saveCatalogLocked()
}
func mergeShow(n,o Show) Show { n.TMDBID=o.TMDBID;n.RecognizedTitle=o.RecognizedTitle;n.OriginalTitle=o.OriginalTitle;n.Overview=o.Overview;n.PosterURL=o.PosterURL;n.BackdropURL=o.BackdropURL;n.Rating=o.Rating;n.Genres=o.Genres;n.MetadataStatus=o.MetadataStatus;n.AddedAt=o.AddedAt;return n }
func (s *Store) Snapshot() State { s.mu.RLock();defer s.mu.RUnlock();b,_:=json.Marshal(s.state);var out State;_=json.Unmarshal(b,&out);return out }
func (s *Store) SetState(st State) error { s.mu.Lock();defer s.mu.Unlock();progress:=s.state.Progress;s.state=st;s.state.Progress=progress;return s.saveCatalogLocked() }
func (s *Store) SetProgress(p Progress) error { s.mu.Lock();defer s.mu.Unlock();p.UpdatedAt=now();if p.Completed!=0{p.Completed=1};s.state.Progress[p.SourceURL]=p;return s.saveProgressLocked() }
func (s *Store) GetProgress(url string) Progress { s.mu.RLock();defer s.mu.RUnlock();if p,ok:=s.state.Progress[url];ok{return p};return Progress{SourceURL:url} }
func Catalog(st State) map[string]any {
	movies:=append([]Movie(nil),st.Movies...)
	shows:=make([]map[string]any,0,len(st.Shows))
	sort.Slice(movies,func(i,j int)bool{return movies[i].AddedAt>movies[j].AddedAt})
	for _,sh:=range st.Shows{
		seasons:=map[int]bool{}
		episodeCount:=0
		extraCount:=0
		for _,e:=range st.Episodes{
			if e.ShowID!=sh.ID { continue }
			if isExtra(e) { extraCount++; continue }
			episodeCount++; seasons[e.Season]=true
		}
		m:=toMap(sh)
		m["episode_count"]=episodeCount
		m["season_count"]=len(seasons)
		m["extra_count"]=extraCount
		shows=append(shows,m)
	}
	return map[string]any{"movies":movies,"shows":shows}
}
func toMap(v any) map[string]any { b,_:=json.Marshal(v);var m map[string]any;_=json.Unmarshal(b,&m);return m }
