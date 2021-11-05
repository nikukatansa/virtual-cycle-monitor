import React, { useState, useEffect, useRef } from 'react'
import { Map, GeoJSON, TileLayer, Circle, Marker } from 'react-leaflet'
import './App.css'
import { waypoints } from './route.json'
import {
  features,
  route,
  full_dist
} from './Fonseca_Bluefields_out.json'


import L from 'leaflet'

// Firebase configuration
import initFirebase from './firebase'
import firebase from 'firebase/app'
import 'firebase/firestore'
initFirebase()
const db = firebase.firestore()
const stat_doc = db.collection('cycle-updates')

let initial_load = true

let DefaultIcon = L.icon({
  iconUrl: './icons8-image-48.png',
  iconSize: [32, 32],
  iconAnchor: [16, 26]
})

L.Marker.prototype.options.icon = DefaultIcon

// Save full route for later partitioning
const full_route = features[0].geometry.coordinates

function useInterval(callback, delay) {
  const savedCallback = useRef()

  // Remember the latest callback.
  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  // Set up the interval.
  useEffect(() => {
    function tick() {
      savedCallback.current()
    }
    if (delay !== null) {
      let id = setInterval(tick, delay)
      return () => clearInterval(id)
    }
  }, [delay])
}

export default () => {
  const cyclingEastIcon = new L.Icon({
    iconUrl: './icons8-man-biking-80.png',
    iconRetinaUrl: './icons8-man-biking-80.png',
    iconAnchor: [66, 80],
    iconSize: [80, 80]
  })

  const cyclingWestIcon = new L.Icon({
    iconUrl: './icons8-man-biking-80-reverse.png',
    iconRetinaUrl: './icons8-man-biking-80-reverse.png',
    iconAnchor: [14, 80],
    iconSize: [80, 80]
  })

  const degreesToRadians = (degrees) => {
    return (degrees * Math.PI) / 180
  }

  const radiansToDegrees = (radians) => {
    return (radians * 180) / Math.PI
  }

  const intermediatePoint = (lat1, long1, lat2, long2, f) => {
    // http://fraserchapman.blogspot.com/2008/09/intermediate-points-on-great-circle.html
    lat1 = degreesToRadians(lat1)
    long1 = degreesToRadians(long1)
    lat2 = degreesToRadians(lat2)
    long2 = degreesToRadians(long2)
    const d =
      2 *
      Math.asin(
        Math.sqrt(
          Math.pow(Math.sin((lat1 - lat2) / 2), 2) +
            Math.cos(lat1) *
              Math.cos(lat2) *
              Math.pow(Math.sin((long1 - long2) / 2), 2)
        )
      )
    const A = Math.sin((1 - f) * d) / Math.sin(d)
    const B = Math.sin(f * d) / Math.sin(d)
    const x =
      A * Math.cos(lat1) * Math.cos(long1) +
      B * Math.cos(lat2) * Math.cos(long2)
    const y =
      A * Math.cos(lat1) * Math.sin(long1) +
      B * Math.cos(lat2) * Math.sin(long2)
    const z = A * Math.sin(lat1) + B * Math.sin(lat2)
    const lat = Math.atan2(z, Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2)))
    const long = Math.atan2(y, x)

    return [radiansToDegrees(lat), radiansToDegrees(long)]
  }

  const calculateDist = (long1, lat1, long2, lat2) => {
    // https://stackoverflow.com/questions/365826/calculate-distance-between-2-gps-coordinates
    let earthRadiusM = 6371e3
    let dLat = degreesToRadians(lat2 - lat1)
    let dLong = degreesToRadians(long2 - long1)
    lat1 = degreesToRadians(lat1)
    lat2 = degreesToRadians(lat2)
    let a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLong / 2) *
        Math.sin(dLong / 2) *
        Math.cos(lat1) *
        Math.cos(lat2)
    let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return earthRadiusM * c
  }

  const createRoute = () => {
    const base_data = getGeoJSON().features[0].geometry.coordinates
    let dist_data = []
    let total_dist = 0
    let seg_dist = 0
    dist_data.push([base_data[0][0], base_data[0][1], 0])
    for (let i = 1; i < base_data.length; i++) {
      seg_dist = calculateDist(
        base_data[i - 1][0],
        base_data[i - 1][1],
        base_data[i][0],
        base_data[i][1]
      )
      total_dist += seg_dist
      dist_data.push([base_data[i][0], base_data[i][1], total_dist])
    }
    return dist_data
  }

  const populateStages = () => {
    let stgs = []
    let prev_dist = 0
    for (let i = 0; i < waypoints.length; i++) {
      let dist = parseInt(route[waypoints[i].leg][2])
      stgs.push({
        ...waypoints[i],
        stage_d: dist - prev_dist,
        total_d: dist,
        stage_t: 0
      })
      prev_dist = dist
    }
    return stgs
  }

  // eslint-disable-next-line
  const [route, setRoute] = useState(() => createRoute())
  const [lat, setLat] = useState(route[0][1])
  const [long, setLong] = useState(route[0][0])
  const [dist, setDist] = useState(0)
  const [tick, setTick] = useState(0)
  const [curStage, setCurStage] = useState(0)
  const [legDirection, setLegDirection] = useState('east')
  const [startTick, setStartTick] = useState(0)
  const [speed, setSpeed] = useState(0)
  const [active, setActive] = useState(false)
  const [stages, setStages] = useState(populateStages())
  const summaryMapRef = useRef(null)

  const nextWalkFrame = () => {
    const new_dist = dist + (speed * 1000) / 3600 // Assumes 1 fps
    const new_tick = tick + 1
    setDist(new_dist)
    setTick(new_tick)
    const leg = route.findIndex((element) => element[2] > new_dist) - 1
    if (leg === -2) {
      // Past the end of the route
      setLat(route[route.length - 1][1])
      setLong(route[route.length - 1][0])
      setActive(false)
      setSpeed(0)
    } else {
      const leg_dist = new_dist - route[leg][2]
      const new_point = intermediatePoint(
        route[leg][1],
        route[leg][0],
        route[leg + 1][1],
        route[leg + 1][0],
        leg_dist / (route[leg + 1][2] - route[leg][2])
      )
      setLat(new_point[0])
      setLong(new_point[1])
    }
    if (leg !== -2) {
      if (leg >= stages[curStage].leg) {
        // This is the first tick of a new stage
        setCurStage(curStage + 1)
        setStartTick(new_tick)
      }
      const new_stages = [
        ...stages.slice(0, curStage),
        { ...stages[curStage], stage_t: new_tick - startTick },
        ...stages.slice(curStage + 1)
      ]
      setStages(new_stages)
    }
    // Calculate leg direction
    if (leg !== -2 && leg + 1 < route.length) {
      if (route[leg][0] < route[leg + 1][0]) {
        setLegDirection('east')
      } else {
        setLegDirection('west')
      }
    }
  }

  useInterval(() => {
    if (active === true) {
      nextWalkFrame()
    }
  }, 1000)

  // Scroll destination list to current route leg on first load only
  useEffect(() => {
    if (document.getElementsByClassName('table_row current_row').length > 0) {
      document
        .getElementsByClassName('table_row current_row')[0]
        .scrollIntoView()
    }
  }, [])

  useEffect(() => {
    function handleResize() {
      if (document.getElementsByClassName('table_row current_row').length > 0) {
        document
          .getElementsByClassName('table_row current_row')[0]
          .scrollIntoView()
      }
    }
    window.addEventListener('resize', handleResize)
  })

  const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600)
    const hour_rem = seconds % 3600
    const mins = Math.floor(hour_rem / 60)
    const secs = hour_rem % 60
    const time_str =
      hours.toString().padStart(2, 0) +
      ':' +
      mins.toString().padStart(2, 0) +
      ':' +
      secs.toString().padStart(2, 0)
    return time_str
  }

  const formatShortTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    const time_str =
      mins.toString().padStart(2, 0) + ':' + secs.toString().padStart(2, 0)
    return time_str
  }

  const formatDistAsMetres = (metres) => {
    return metres.toLocaleString('en') + 'm'
  }

  const formatPercentage = (percentage) => {
    return (100 * percentage).toFixed(1) + '%'
  }

  useEffect(() => {
    // eslint-disable-next-line
    const unsubscribe = stat_doc.onSnapshot((snapshot) => {
      if (snapshot.size) {
        const cur_data = snapshot.docs[0].data()
        // Only set active to cur_data.active if less than four minutes have elapsed
        // since last Firestore update - guards against errors due to walk not being
        // stopped on main app - else assume that we are inactive.
        const time_now = firebase.firestore.Timestamp.fromDate(new Date())
        if (time_now - cur_data.timestamp < 240) {
          setActive(cur_data.active)
          if (cur_data.active) {
            setSpeed(cur_data.speed)
          } else {
            setSpeed(0)
          }
        } else {
          setActive(false)
          setSpeed(0)
        }
        setDist(cur_data.dist)
        setTick(cur_data.tick)
        setStartTick(cur_data.start_tick)
        setCurStage(cur_data.cur_stage)

        // Populate stages data
        let new_stages = []
        new_stages = stages.map((stage, index) => {
          return { ...stage, stage_t: cur_data.stage_times[index] }
        })
        setStages(new_stages)
        // Calculate current position

        const leg = route.findIndex((element) => element[2] > cur_data.dist) - 1
        if (leg === -2) {
          // Past the end of the route
          setLat(route[route.length - 1][1])
          setLong(route[route.length - 1][0])
          setActive(false)
        } else {
          const leg_dist = cur_data.dist - route[leg][2]
          const new_point = intermediatePoint(
            route[leg][1],
            route[leg][0],
            route[leg + 1][1],
            route[leg + 1][0],
            leg_dist / (route[leg + 1][2] - route[leg][2])
          )
          setLat(new_point[0])
          setLong(new_point[1])
        }
        // Calculate leg direction
        if (leg !== -2 && leg + 1 < route.length) {
          if (route[leg][0] < route[leg + 1][0]) {
            setLegDirection('east')
          } else {
            setLegDirection('west')
          }
        }
        if (initial_load) {
          if (
            document.getElementsByClassName('table_row current_row').length > 0
          ) {
            document
              .getElementsByClassName('table_row current_row')[0]
              .scrollIntoView()
          }
          initial_load = false
        }
      } else {
        console.log('Snapshot has no data')
      }
    })
    // eslint-disable-next-line
  }, [stat_doc])

  const onMove = (event) => {
    // if (summaryMapRef.current.viewport.center !== undefined){
    summaryMapRef.current.leafletElement.setView(event.target.getCenter(), 11)
    // }
  }

  return (
    <div id="container">
      <div id="map_area">
        <Map
          id="full_map"
          center={[lat, long]}
          zoom={17}
          dragging={true}
          keyboard={true}
          scrollWheelZoom={true}
          zoomControl={true}
          doubleClickZoom={false}
          onmoveend={onMove.bind(this)}
        >
          {/* <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors &bull; <a target="_blank" href="https://icons8.com/icons/set/walking">Walking</a>, <a target="_blank" href="https://icons8.com/icons/set/image">Image</a> icons by <a target="_blank" href="https://icons8.com">Icons8</a>'
          /> */}
          <TileLayer
            url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png"
            attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors &bull; <a target="_blank" href="https://icons8.com/icon/ITgKZ3xjWphi/person-biking">Cycling icon</a> by <a target="_blank" href="https://icons8.com">Icons8</a>'
          />
          <GeoJSON data={getGeoJSON()} style={styleRoute} />
          {legDirection === 'east' ? (
            <Marker position={[lat, long]} icon={cyclingEastIcon}></Marker>
          ) : (
            <Marker position={[lat, long]} icon={cyclingWestIcon}></Marker>
          )}
        </Map>
        <div id="summary_border"></div>
        <Map
          id="summary_map"
          ref={summaryMapRef}
          center={[lat, long]}
          zoom={11}
          dragging={false}
          keyboard={false}
          scrollWheelZoom={false}
          zoomControl={false}
          doubleClickZoom={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
          />
          <GeoJSON data={getGeoJSON()} style={styleRoute} />
          <Circle center={[lat, long]} radius="10" />
        </Map>
      </div>
      <div id="summary_area">
        <div id="summary_stats">
          <h1 className="summary_title">SIFT's Virtual Cycle Ride</h1>
          <div id="total_dist" className="summary_row">
            <div className="md_summary">Distance cycled: </div>
            <div className="lg_summary">
              {formatDistAsMetres(parseInt(dist))} (
              {formatPercentage(parseInt(dist) / full_dist)})
            </div>
          </div>
          <div id="total_time" className="summary_row">
            <div className="md_summary">Cycling time: </div>
            <div className="lg_summary">{formatTime(tick)}</div>
          </div>
          <h2 className="sponsor_details">
            Please{' '}
            <a href="https://www.justgiving.com/fundraising/sift-virtual-cycle">
              find out more and sponsor Graham
            </a>
            !
          </h2>
        </div>
        <div id="monitor">
          <div className="table_row header">
            <div className="locn_desc">Destination</div>
            <div className="locn_time">Time on stage</div>
            <div className="locn_dist">Stage distance</div>
            <div className="locn_rem" style={{ textAlign: 'center' }}>
              Distance left
            </div>
          </div>
          {stages.map((stage, index) => {
            let class_n = 'table_row'
            let stage_r = stage.stage_d
            if (stage.total_d >= dist && dist > stage.total_d - stage.stage_d) {
              if (active === true) {
                class_n = 'table_row current_row active'
              } else {
                class_n = 'table_row current_row inactive'
              }
              stage_r = parseInt(stage.total_d - dist)
            } else if (dist > stage.total_d) {
              stage_r = 0
            }
            return (
              <div key={index} className={`${class_n}`}>
                <div className="locn_desc">{stage.location}</div>
                <div className="locn_time">
                  {formatShortTime(stage.stage_t)}
                </div>
                <div className="locn_dist">
                  {formatDistAsMetres(stage.stage_d)}
                </div>
                <div className="locn_rem">{formatDistAsMetres(stage_r)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function styleRoute() {
  return {
    color: 'orange'
  }
}

function getGeoJSON() {
  return {
    type: 'FeatureCollection',
    properties: {
      name: 'Virtual Cycle Ride',
      description: 'Generated by AllTrails https://www.alltrails.com/',
      styleUrl: '#gpsiesStyle1'
    },
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: full_route
        }
      }
    ],
    name: 'Virtual Cycle Ride route'
  }
}

