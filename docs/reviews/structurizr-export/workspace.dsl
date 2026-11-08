workspace "Trail Notes" "From the people who use Trail Notes to its illustrative visitor center deployment." {
    !impliedRelationships false
    model {
        c4_hiker_bd2444b5dd51 = person "Hiker" ""
        c4_steward_ec1f37bd5433 = person "Trail steward" ""
        c4_notes_7106217709f9 = softwareSystem "Trail Notes" "" {
            c4_web_03bcfc1fa9b3 = container "Trail Notes web app" "" "TypeScript / React"
            c4_api_d567348e3953 = container "Notes API" "" "TypeScript / Node.js" {
                c4_handler_b23f48294cd3 = component "Note submission handler" "" "TypeScript"
                c4_service_1a8038cf5e5b = component "Note service" "" "TypeScript"
                c4_validation_83a415906f07 = component "Note validation" "" "TypeScript"
                c4_repository_2ab5fd80aea3 = component "Note repository" "" "In-memory adapter"
            }
            c4_db_d774033add80 = container "Notes database" "" "PostgreSQL" "Database"
            c4_client_08ea51ed8a9d = container "Trail Notes client" "" "TypeScript"
            c4_proxy_ec97ba211c8c = container "Web server and reverse proxy" "Terminates TLS, serves web assets, and forwards note API requests to the local API process." "Caddy"
        }
        c4_trail_data_25ff05dff206 = softwareSystem "Regional trail catalog" "" "External"
        c4_hiker_bd2444b5dd51 -> c4_notes_7106217709f9 "Records trail observations" "" "C4R1"
        c4_steward_ec1f37bd5433 -> c4_notes_7106217709f9 "Reviews submitted notes" "" "C4R2"
        c4_notes_7106217709f9 -> c4_trail_data_25ff05dff206 "Looks up trail details" "HTTPS" "C4R3"
        c4_hiker_bd2444b5dd51 -> c4_web_03bcfc1fa9b3 "Submits trail observations" "HTTPS" "C4R4"
        c4_steward_ec1f37bd5433 -> c4_web_03bcfc1fa9b3 "Reviews submitted notes" "HTTPS" "C4R5"
        c4_web_03bcfc1fa9b3 -> c4_api_d567348e3953 "Submits and reads notes" "HTTPS / JSON" "C4R6"
        c4_api_d567348e3953 -> c4_db_d774033add80 "Stores and retrieves notes" "SQL over TLS" "C4R7"
        c4_api_d567348e3953 -> c4_trail_data_25ff05dff206 "Looks up trail details" "HTTPS" "C4R8"
        c4_client_08ea51ed8a9d -> c4_handler_b23f48294cd3 "Retries with the same request key" "" "C4R9" {
            properties {
                "c4.description" "trail-client.ts:18 · trail-client.ts:21 · demo.ts:22"
            }
        }
        c4_handler_b23f48294cd3 -> c4_service_1a8038cf5e5b "Forwards author, key, and draft" "" "C4R10" {
            properties {
                "c4.description" "submit-note.ts:21 · submit-note.ts:22"
            }
        }
        c4_service_1a8038cf5e5b -> c4_validation_83a415906f07 "Validates the draft before saving" "" "C4R11" {
            properties {
                "c4.description" "note-service.ts:10 · note.ts:4"
            }
        }
        c4_service_1a8038cf5e5b -> c4_repository_2ab5fd80aea3 "Delegates duplicate prevention" "" "C4R12" {
            properties {
                "c4.description" "note-service.ts:11 · note-repository.ts:24"
            }
        }
        c4_proxy_ec97ba211c8c -> c4_api_d567348e3953 "API on loopback · 8080" "HTTP over TCP 8080" "C4DeploymentR1" {
            properties {
                "C4 description" "The proxy forwards API requests to 127.0.0.1 on the same physical server."
            }
        }
        c4_api_d567348e3953 -> c4_db_d774033add80 "Private SQL over TLS · 5432" "PostgreSQL over TLS, TCP 5432" "C4DeploymentR2" {
            properties {
                "C4 description" "The API uses the private connection between the separate application and database hosts."
            }
        }
        deploymentEnvironmentView = deploymentEnvironment "Visitor center" {
            deploymentGroup1 = deploymentGroup "Physical link 1"
            deploymentGroup2 = deploymentGroup "Physical link 2"
            deploymentGroup3 = deploymentGroup "Isolated instance deploymentNode2"
            deploymentNode1 = deploymentNode "Field tablet" "" "Physical Android device" {
                deploymentNode2 = containerInstance c4_web_03bcfc1fa9b3 deploymentGroup3 {
                    description "A hiker uses the web app over a mobile data connection."
                    properties {
                        "C4 technology" "Browser"
                    }
                }
            }
            deploymentNode3 = deploymentNode "Visitor center equipment room" "" "On-site hardware" {
                deploymentNode4 = infrastructureNode "Edge firewall" "The public ingress rule forwards only TCP 443 to the application server. The database has no public ingress rule." "Physical appliance"
                deploymentNode5 = deploymentNode "Application server" "" "Bare-metal Linux" {
                    deploymentNode6 = containerInstance c4_proxy_ec97ba211c8c deploymentGroup1 {
                        description "Terminates TLS, serves web assets, and forwards note API requests to the local API process."
                        properties {
                            "C4 technology" "Caddy"
                        }
                    }
                    deploymentNode7 = containerInstance c4_api_d567348e3953 deploymentGroup1,deploymentGroup2 {
                        description "Binds to loopback on the application server. This illustrative deployment uses a database adapter."
                        properties {
                            "C4 technology" "Node.js"
                        }
                    }
                }
                deploymentNode8 = deploymentNode "Database server" "" "Bare-metal Linux" {
                    deploymentNode9 = containerInstance c4_db_d774033add80 deploymentGroup2 {
                        description "Accepts database traffic from the application server over the private network. The runnable retry fixture uses a separate in-memory store."
                        properties {
                            "C4 technology" "PostgreSQL"
                        }
                    }
                }
            }
            deploymentRelationship1 = deploymentNode2 -> deploymentNode4 "Public HTTPS · 443" "TCP 443 over the Internet" {
                properties {
                    "C4 description" "Loads the web UI and submits notes over the same HTTPS connection path."
                }
            }
            deploymentRelationship2 = deploymentNode4 -> deploymentNode6 "Forwards TCP 443" "TCP 443" {
                properties {
                    "C4 description" "The hardware firewall forwards ingress to the reverse proxy. TLS terminates at the proxy."
                }
            }
        }
    }
    views {
        systemContext c4_notes_7106217709f9 Context "People and the catalog involved in recording and reviewing observations" {
            title "Trail Notes | Context"
            include c4_hiker_bd2444b5dd51 c4_steward_ec1f37bd5433 c4_notes_7106217709f9 c4_trail_data_25ff05dff206
            exclude relationship.tag==C4DeploymentR1
            exclude relationship.tag==C4DeploymentR2
            autoLayout lr 170 130
        }
        container c4_notes_7106217709f9 Container "Inside Trail Notes: the web app, Notes API, and database" {
            title "Trail Notes | Container"
            include c4_hiker_bd2444b5dd51 c4_steward_ec1f37bd5433 c4_web_03bcfc1fa9b3 c4_api_d567348e3953 c4_db_d774033add80 c4_trail_data_25ff05dff206
            exclude relationship.tag==C4DeploymentR1
            exclude relationship.tag==C4DeploymentR2
            autoLayout lr 170 130
        }
        component c4_api_d567348e3953 Component "Notes API · Who owns retry, validation, and duplicate prevention?" {
            title "Trail Notes | Component"
            include c4_client_08ea51ed8a9d c4_handler_b23f48294cd3 c4_service_1a8038cf5e5b c4_validation_83a415906f07 c4_repository_2ab5fd80aea3
            exclude relationship.tag==C4DeploymentR1
            exclude relationship.tag==C4DeploymentR2
            autoLayout lr 170 130
        }
        deployment c4_notes_7106217709f9 deploymentEnvironmentView "PhysicalDeployment" "Illustrative visitor center installation" {
            title "Trail Notes | Physical deployment"
            include *
            exclude relationship==*
            include deploymentRelationship1
            include deploymentRelationship2
            include "relationship==deploymentNode6->deploymentNode7 && relationship.tag==C4DeploymentR1"
            include "relationship==deploymentNode7->deploymentNode9 && relationship.tag==C4DeploymentR2"
            autoLayout lr
        }
        styles {
            element "Person" {
                shape Person
                background #08427b
                color #ffffff
            }
            element "Software System" {
                background #1168bd
                color #ffffff
            }
            element "Container" {
                background #2d74a7
                color #ffffff
            }
            element "Component" {
                background #d9e9f6
                color #17334a
            }
            element "External" {
                background #596779
                color #ffffff
            }
            element "Database" {
                shape Cylinder
            }
            element "Infrastructure Node" {
                background #596779
                color #ffffff
            }
        }
    }
}
