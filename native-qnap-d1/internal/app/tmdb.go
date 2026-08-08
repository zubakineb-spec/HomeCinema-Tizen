package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type TMDB struct { token string; client *http.Client }
func NewTMDB(token string)*TMDB{return &TMDB{token:strings.TrimSpace(token),client:&http.Client{Timeout:12*time.Second}}}
func(t *TMDB)enabled()bool{return t.token!=""}
func(t *TMDB)get(path string,q url.Values,out any)error{if !t.enabled(){return fmt.Errorf("disabled")};u:="https://api.themoviedb.org/3"+path;if len(q)>0{u+="?"+q.Encode()};req,_:=http.NewRequest("GET",u,nil);req.Header.Set("Authorization","Bearer "+t.token);req.Header.Set("Accept","application/json");r,e:=t.client.Do(req);if e!=nil{return e};defer r.Body.Close();if r.StatusCode/100!=2{return fmt.Errorf("tmdb %s",r.Status)};return json.NewDecoder(r.Body).Decode(out)}
func image(p,size string)string{if p==""{return ""};return "https://image.tmdb.org/t/p/"+size+p}
type searchResp struct{Results []struct{ID int `json:"id"`} `json:"results"`}
type details struct{ID int `json:"id"`;Title string `json:"title"`;Name string `json:"name"`;OriginalTitle string `json:"original_title"`;OriginalName string `json:"original_name"`;Overview string `json:"overview"`;PosterPath string `json:"poster_path"`;BackdropPath string `json:"backdrop_path"`;Vote float64 `json:"vote_average"`;Runtime int `json:"runtime"`;Genres []struct{Name string `json:"name"`} `json:"genres"`;StillPath string `json:"still_path"`;AirDate string `json:"air_date"`}
func names(g []struct{Name string `json:"name"`})string{a:=[]string{};for _,x:=range g{if x.Name!=""{a=append(a,x.Name)}};return strings.Join(a,", ")}
func(t *TMDB)Movie(title string,year int)(details,error){q:=url.Values{"query":{title},"language":{"ru-RU"},"include_adult":{"false"}};if year>0{q.Set("year",strconv.Itoa(year))};var s searchResp;if e:=t.get("/search/movie",q,&s);e!=nil||len(s.Results)==0{return details{},e};var d details;e:=t.get("/movie/"+strconv.Itoa(s.Results[0].ID),url.Values{"language":{"ru-RU"}},&d);return d,e}
func(t *TMDB)Show(title string)(details,error){q:=url.Values{"query":{title},"language":{"ru-RU"},"include_adult":{"false"}};var s searchResp;if e:=t.get("/search/tv",q,&s);e!=nil||len(s.Results)==0{return details{},e};var d details;e:=t.get("/tv/"+strconv.Itoa(s.Results[0].ID),url.Values{"language":{"ru-RU"}},&d);return d,e}
func(t *TMDB)Episode(show,season,ep int)(details,error){var d details;e:=t.get(fmt.Sprintf("/tv/%d/season/%d/episode/%d",show,season,ep),url.Values{"language":{"ru-RU"}},&d);return d,e}
