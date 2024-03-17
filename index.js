require('dotenv').config()
const express = require('express')
const { generateSlug } = require('random-word-slugs') // for creating the random slugs for the project_id, eg: elegant-green-coat
const { ECSClient, RunTaskCommand, CreateClusterCommand} = require('@aws-sdk/client-ecs') // AWS S3 client library
const Redis = require('ioredis') 
// const { Server } = require('socket.io')

const app = express()
const PORT = process.env.PORT || 9000
const REDIS_URI = process.env.REDIS_URI
const ACCESS_KEY = process.env.IAM_ACCESS_KEY
const SECRET_KEY = process.env.IAM_SECRET_KEY

const subscriber = new Redis(REDIS_URI)


const server = app.listen(
    PORT,
    console.log(`Server running on PORT ${PORT}...`)
);

// const io = new Server({ cors: '*' })
const io = require("socket.io")(server, {
    pingTimeout: 60000,
    cors: {
      origin: "http://localhost:3000",
      // credentials: true,
    },
  });

io.on('connection', socket => {
    socket.on('subscribe', channel => {
        socket.join(channel)
        socket.emit('message', `Joined ${channel}`)
    })
})

// io.listen(9002, () => console.log('Socket Server 9002'))

const ecsClient = new ECSClient({
    region: 'ap-south-1',
    credentials:{
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY
    }
})

const config = {
    CLUSTER: process.env.ECS_CLUSTER,
    TASK: process.env.ECS_TASK
}


app.use(express.json())


app.post('/project', async (req,res)=>{
    const { gitURL, slug} = req.body
    const projectSlug = slug ? slug : generateSlug()

    const create_command = new CreateClusterCommand({
        clusterName: "builder-cluster"
    })
    
    await ecsClient.send(create_command)

    const command = new RunTaskCommand({
        cluster: config.CLUSTER,
        taskDefinition: config.TASK,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
            awsvpcConfiguration: {
                assignPublicIp: 'ENABLED',
                subnets : process.env.SUBNETS.split(','),
                securityGroups : process.env.SECURITY_GROUPS.split(',')
            }
        },
        overrides:{
            containerOverrides: [
                {
                    name: 'builder-image',
                    environment: [
                        {
                            name: 'GIT_REPOSITORY_URL', 
                            value: gitURL
                        },
                        {
                            name: 'PROJECT_ID',
                            value: projectSlug
                        }
                    ]
                }
            ]
        }
    })

    await ecsClient.send(command)
    return res.json({status: 'queued', data: {projectSlug,url: `http://${projectSlug}.localhost:8000`}})
})


async function initRedisSubscribe() {
    console.log('Subscribed to logs....')
    subscriber.psubscribe('logs:*')
    subscriber.on('pmessage', (pattern, channel, message) => {
        io.to(channel).emit('message', message)
    })
}


initRedisSubscribe()


// app.listen(PORT, () => console.log(`API Server Running..${PORT}`))
